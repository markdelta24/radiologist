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
 * Upload a frame image to Supabase Storage
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
