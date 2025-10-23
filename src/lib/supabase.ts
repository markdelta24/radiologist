import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Upload a video file to Supabase Storage
 * @param file - The video file to upload
 * @param fileName - The name to save the file as
 * @returns The public URL of the uploaded file
 */
export async function uploadVideoToSupabase(file: File, fileName: string) {
  const { data, error } = await supabase.storage
    .from('medical-videos')
    .upload(fileName, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (error) {
    throw new Error(`Failed to upload video: ${error.message}`);
  }

  // Get the public URL
  const { data: urlData } = supabase.storage
    .from('medical-videos')
    .getPublicUrl(data.path);

  return {
    path: data.path,
    url: urlData.publicUrl
  };
}

/**
 * Upload multiple DICOM files to Supabase Storage
 * @param files - Array of DICOM files
 * @param patientFolder - Folder name for organizing DICOM files (e.g., timestamp-patientID)
 * @returns Array of uploaded file paths and URLs
 */
export async function uploadDicomFilesToSupabase(
  files: File[],
  patientFolder: string
): Promise<Array<{ path: string; url: string; fileName: string }>> {
  const uploadPromises = files.map(async (file) => {
    const filePath = `${patientFolder}/${file.name}`;

    const { data, error } = await supabase.storage
      .from('medical-videos')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: 'application/dicom'
      });

    if (error) {
      console.error(`Failed to upload ${file.name}:`, error.message);
      throw new Error(`Failed to upload ${file.name}: ${error.message}`);
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from('medical-videos')
      .getPublicUrl(data.path);

    return {
      path: data.path,
      url: urlData.publicUrl,
      fileName: file.name
    };
  });

  return await Promise.all(uploadPromises);
}

/**
 * Delete a video file from Supabase Storage
 * @param filePath - The path of the file to delete
 */
export async function deleteVideoFromSupabase(filePath: string) {
  const { error } = await supabase.storage
    .from('medical-videos')
    .remove([filePath]);

  if (error) {
    throw new Error(`Failed to delete video: ${error.message}`);
  }
}

/**
 * Delete multiple DICOM files from Supabase Storage
 * @param filePaths - Array of file paths to delete
 */
export async function deleteDicomFilesFromSupabase(filePaths: string[]) {
  const { error } = await supabase.storage
    .from('medical-videos')
    .remove(filePaths);

  if (error) {
    throw new Error(`Failed to delete DICOM files: ${error.message}`);
  }
}

/**
 * Delete an entire patient folder from Supabase Storage
 * @param folderPath - The folder path to delete
 */
export async function deletePatientFolderFromSupabase(folderPath: string) {
  const { data, error: listError } = await supabase.storage
    .from('medical-videos')
    .list(folderPath);

  if (listError) {
    throw new Error(`Failed to list folder contents: ${listError.message}`);
  }

  if (data && data.length > 0) {
    const filePaths = data.map(file => `${folderPath}/${file.name}`);
    await deleteDicomFilesFromSupabase(filePaths);
  }
}

/**
 * Upload a frame image to Supabase Storage (server-side with Buffer)
 * @param buffer - The image buffer
 * @param fileName - The name to save the file as
 * @param sessionId - The session/analysis ID for organizing frames
 * @returns The path and URL of the uploaded frame
 */
export async function uploadFrameToSupabase(
  buffer: Buffer,
  fileName: string,
  sessionId: string
) {
  const filePath = `${sessionId}/${fileName}`;

  const { data, error } = await supabase.storage
    .from('medical-frames')
    .upload(filePath, buffer, {
      cacheControl: '3600',
      upsert: false,
      contentType: 'image/png'
    });

  if (error) {
    throw new Error(`Failed to upload frame: ${error.message}`);
  }

  // Get the public URL
  const { data: urlData } = supabase.storage
    .from('medical-frames')
    .getPublicUrl(data.path);

  return {
    path: data.path,
    url: urlData.publicUrl
  };
}

/**
 * Upload a frame image to Supabase Storage (client-side from base64)
 * @param base64Data - The base64 image data URL
 * @param fileName - The name to save the file as
 * @param sessionId - The session/analysis ID for organizing frames
 * @returns The path and URL of the uploaded frame
 */
async function uploadWithRetry(
  blob: Blob,
  filePath: string,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<{ path: string }> {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { data, error } = await supabase.storage
        .from('medical-frames')
        .upload(filePath, blob, {
          cacheControl: '3600',
          upsert: false,
          contentType: 'image/png'
        });

      if (error) {
        // Check if it's a retryable error
        if (error.message.includes('timeout') || error.message.includes('504') || error.message.includes('503')) {
          lastError = error;
          const delay = baseDelay * Math.pow(2, attempt);
          console.warn(`Upload timeout on attempt ${attempt + 1}/${maxRetries}, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }

      return { path: data.path };
    } catch (error: any) {
      lastError = error;

      // Check if it's a retryable error (network/timeout)
      const isRetryable = error.message?.includes('timeout') ||
                         error.message?.includes('504') ||
                         error.message?.includes('503') ||
                         error.message?.includes('network') ||
                         error.name === 'NetworkError';

      if (isRetryable && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`Upload error on attempt ${attempt + 1}/${maxRetries}, retrying in ${delay}ms...`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Failed to upload after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
}

export async function uploadFrameFromClient(
  base64Data: string,
  fileName: string,
  sessionId: string
) {
  const filePath = `${sessionId}/${fileName}`;

  // Convert base64 to blob
  const base64String = base64Data.split(',')[1];
  const byteCharacters = atob(base64String);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: 'image/png' });

  // Upload with retry logic
  const { path } = await uploadWithRetry(blob, filePath);

  // Get the public URL
  const { data: urlData } = supabase.storage
    .from('medical-frames')
    .getPublicUrl(path);

  return {
    path,
    url: urlData.publicUrl
  };
}

/**
 * Upload multiple frames to Supabase Storage in batches (client-side)
 * @param frames - Array of frame data with base64 data URLs
 * @param sessionId - The session/analysis ID for organizing frames
 * @param batchSize - Number of frames to upload concurrently
 * @param onProgress - Optional callback for progress updates
 * @returns Array of uploaded frame info
 */
export async function uploadFramesInBatches(
  frames: Array<{ dataUrl: string; timestamp: number; frameNumber: number }>,
  sessionId: string,
  batchSize: number = 10,
  onProgress?: (uploaded: number, total: number) => void
): Promise<Array<{ path: string; url: string; frameNumber: number; timestamp: number }>> {
  const results: Array<{ path: string; url: string; frameNumber: number; timestamp: number }> = [];

  for (let i = 0; i < frames.length; i += batchSize) {
    const batch = frames.slice(i, i + batchSize);

    const batchPromises = batch.map(async (frame) => {
      const fileName = `frame_${String(frame.frameNumber).padStart(3, '0')}.png`;
      const { path, url } = await uploadFrameFromClient(frame.dataUrl, fileName, sessionId);
      return {
        path,
        url,
        frameNumber: frame.frameNumber,
        timestamp: frame.timestamp
      };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    if (onProgress) {
      onProgress(results.length, frames.length);
    }
  }

  return results;
}

/**
 * Download a frame from Supabase Storage
 * @param path - The storage path of the frame
 * @returns The frame data as a Buffer
 */
export async function downloadFrameFromSupabase(path: string): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from('medical-frames')
    .download(path);

  if (error || !data) {
    throw new Error(`Failed to download frame: ${error?.message || 'No data'}`);
  }

  // Convert blob to buffer
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Save analysis session to database
 * @param sessionData - The analysis session data
 */
export async function saveAnalysisSession(sessionData: {
  sessionId: string;
  problemStatement?: string;
  videoFilename?: string;
  frameCount: number;
  summary: string;
  recommendations: string[];
  urgency: 'low' | 'medium' | 'high';
}) {
  const { error } = await supabase
    .from('analysis_sessions')
    .insert({
      session_id: sessionData.sessionId,
      problem_statement: sessionData.problemStatement,
      video_filename: sessionData.videoFilename,
      frame_count: sessionData.frameCount,
      summary: sessionData.summary,
      recommendations: sessionData.recommendations,
      urgency: sessionData.urgency
    });

  if (error) {
    throw new Error(`Failed to save analysis session: ${error.message}`);
  }
}

/**
 * Save analysis frame to database
 * @param frameData - The frame analysis data
 */
export async function saveAnalysisFrame(frameData: {
  sessionId: string;
  frameNumber: number;
  timestamp: number;
  analysis: string;
  confidence: number;
  findings: string[];
  supabasePath?: string;
  supabaseUrl?: string;
}) {
  const { error } = await supabase
    .from('analysis_frames')
    .insert({
      session_id: frameData.sessionId,
      frame_number: frameData.frameNumber,
      timestamp: frameData.timestamp,
      analysis: frameData.analysis,
      confidence: frameData.confidence,
      findings: frameData.findings,
      supabase_path: frameData.supabasePath,
      supabase_url: frameData.supabaseUrl
    });

  if (error) {
    throw new Error(`Failed to save analysis frame: ${error.message}`);
  }
}
