import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { uploadFrameToSupabase, saveAnalysisSession, saveAnalysisFrame } from '@/lib/supabase';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});
const GPT_MODEL = process.env.GPT_MODEL || 'gpt-5';
const GPT_MAX_RETRIES = parseInt(process.env.GPT_MAX_RETRIES || '3', 10);
const GPT_RETRY_BASE_DELAY_MS = parseInt(process.env.GPT_RETRY_BASE_DELAY_MS || '500', 10);

interface FrameAnalysis {
  frameNumber: number;
  analysis: string;
  confidence: number;
  findings: string[];
  timestamp: number;
  supabasePath?: string;
  supabaseUrl?: string;
}

interface OverallAnalysis {
  summary: string;
  recommendations: string[];
  urgency: 'low' | 'medium' | 'high';
  frameAnalyses: FrameAnalysis[];
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let heartbeat: NodeJS.Timeout | undefined;
      try {
        // Heartbeat to keep SSE connection alive
        heartbeat = setInterval(() => {
          try { controller.enqueue(encoder.encode(`: keep-alive\n\n`)); } catch {}
        }, 15000);
        // Send initial progress
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 5, step: 'received_request' })}\n\n`));

        // Parse the form data
        const formData = await request.formData();
        const frameCount = parseInt(formData.get('frameCount') as string || '0');
        const problem = (formData.get('problem') as string) || '';
        const sessionId = (formData.get('sessionId') as string) || `analysis_${Date.now()}`;

        if (frameCount === 0) {
          throw new Error('No frames provided');
        }

        // Problem statement (single input)
        const problemStatement = problem.trim();

        // Extract DICOM metadata if available (for DICOM uploads)
        const dicomMetadata = {
          patientName: formData.get('patientName') as string || '',
          patientID: formData.get('patientID') as string || '',
          studyDate: formData.get('studyDate') as string || '',
          modality: formData.get('modality') as string || '',
        };

        // Try to get metadata from first frame if not at form level
        if (!dicomMetadata.patientName && frameCount > 0) {
          const firstFrameMetadata = formData.get('metadata_0') as string;
          if (firstFrameMetadata) {
            try {
              const parsed = JSON.parse(firstFrameMetadata);
              dicomMetadata.patientName = parsed.patientName || '';
              dicomMetadata.patientID = parsed.patientID || '';
              dicomMetadata.studyDate = parsed.studyDate || '';
              dicomMetadata.modality = parsed.modality || '';
            } catch (e) {
              console.error('Failed to parse DICOM metadata:', e);
            }
          }
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 10, step: 'parsing_form_data' })}\n\n`));

        // Create temp directory for frames
        // Use /tmp in production (Vercel/Netlify) or local temp directory
        const isProduction = process.env.VERCEL === '1' || process.env.NETLIFY === 'true' || process.env.NODE_ENV === 'production';
        const tempDir = isProduction ? '/tmp' : path.join(process.cwd(), 'temp');
        const framesDir = path.join(tempDir, `frames_${Date.now()}`);

        // Only try to create parent temp dir if not /tmp (it already exists in serverless)
        if (!isProduction) {
          await fs.mkdir(tempDir, { recursive: true });
        }
        await fs.mkdir(framesDir, { recursive: true });

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 15, step: 'loading_frames_from_storage' })}\n\n`));

        // Process ALL frames in batches - critical for medical diagnosis
        console.log(`Analyzing all ${frameCount} frames in batches for comprehensive medical analysis`);

        // Download and process frames in parallel batches to optimize speed
        const BATCH_SIZE = 50; // Process 50 frames at a time
        const frames: { dataUrl: string; timestamp: number; frameNumber: number; filePath: string; supabasePath?: string; supabaseUrl?: string }[] = [];

        for (let batchStart = 0; batchStart < frameCount; batchStart += BATCH_SIZE) {
          const batchEnd = Math.min(batchStart + BATCH_SIZE, frameCount);
          const batchProgress = 15 + ((batchStart / frameCount) * 25); // 15-40%
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: batchProgress, step: `loading_batch_${Math.floor(batchStart / BATCH_SIZE) + 1}` })}\n\n`));

          // Download frames in parallel for this batch
          const batchPromises = [];

          for (let i = batchStart; i < batchEnd; i++) {
            const frameUrl = formData.get(`frameUrl_${i}`) as string;
            const framePath = formData.get(`framePath_${i}`) as string;
            const timestamp = parseFloat(formData.get(`timestamp_${i}`) as string || '0');
            const frameNumber = parseInt(formData.get(`frameNumber_${i}`) as string || String(i + 1));

            if (frameUrl && framePath) {
              const downloadPromise = (async () => {
                try {
                  const response = await fetch(frameUrl);
                  if (!response.ok) {
                    throw new Error(`Failed to fetch frame from ${frameUrl}`);
                  }
                  const arrayBuffer = await response.arrayBuffer();
                  const buffer = Buffer.from(arrayBuffer);

                  // Save locally for Gemini processing
                  const frameFileName = `frame_${String(frameNumber).padStart(3, '0')}.png`;
                  const localFramePath = path.join(framesDir, frameFileName);
                  await fs.writeFile(localFramePath, buffer);

                  // Convert to base64 for Gemini
                  const base64Data = buffer.toString('base64');
                  const dataUrl = `data:image/png;base64,${base64Data}`;

                  console.log(`Loaded frame ${frameNumber} from Supabase`);

                  return {
                    dataUrl,
                    timestamp,
                    frameNumber,
                    filePath: localFramePath,
                    supabasePath: framePath,
                    supabaseUrl: frameUrl
                  };
                } catch (error) {
                  console.error(`Failed to load frame ${frameNumber} from Supabase:`, error);
                  throw new Error(`Failed to load frame ${frameNumber} from storage`);
                }
              })();

              batchPromises.push(downloadPromise);
            } else {
            // Fallback: frame sent as base64 (backward compatibility)
            const dataUrl = formData.get(`frame_${i}`) as string;
            if (dataUrl) {
              const frameFileName = `frame_${String(frameNumber).padStart(3, '0')}.png`;
              const localFramePath = path.join(framesDir, frameFileName);

              // Convert base64 to buffer and save
              const base64Data = dataUrl.split(',')[1];
              const buffer = Buffer.from(base64Data, 'base64');
              await fs.writeFile(localFramePath, buffer);

              frames.push({
                dataUrl,
                timestamp,
                frameNumber,
                filePath: localFramePath
              });

              console.log(`Saved frame ${frameNumber} from base64 data`);
            }
          }
          }

          // Wait for all frames in this batch to download
          if (batchPromises.length > 0) {
            const batchResults = await Promise.all(batchPromises);
            frames.push(...batchResults);
            console.log(`Batch complete: Loaded ${batchResults.length} frames`);
          }
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 20, step: 'frames_saved', frameCount: frames.length })}\n\n`));

        // Analyze all frames in a single GPT call
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 30, step: 'preparing_model', mode: 'single-call' })}\n\n`));
        const { overall, perFrame } = await analyzeAllFramesWithGPT(frames, problemStatement, dicomMetadata);

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 90, step: 'parsing_results' })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 95, step: 'finalizing' })}\n\n`));

        // Merge Supabase URLs into frame analyses
        const frameAnalysesWithUrls = perFrame.map((fa) => {
          const frame = frames.find(f => f.frameNumber === fa.frameNumber);
          return {
            ...fa,
            supabasePath: frame?.supabasePath,
            supabaseUrl: frame?.supabaseUrl
          };
        });

        // Send final results
        const results: OverallAnalysis = {
          ...overall,
          frameAnalyses: frameAnalysesWithUrls
        };

        // Save to database
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 96, step: 'saving_to_database' })}\n\n`));
        try {
          await saveAnalysisSession({
            sessionId,
            problemStatement,
            frameCount: frames.length,
            summary: overall.summary,
            recommendations: overall.recommendations,
            urgency: overall.urgency
          });

          // Save all frames to database
          for (const fa of frameAnalysesWithUrls) {
            await saveAnalysisFrame({
              sessionId,
              frameNumber: fa.frameNumber,
              timestamp: fa.timestamp,
              analysis: fa.analysis,
              confidence: fa.confidence,
              findings: fa.findings,
              supabasePath: fa.supabasePath,
              supabaseUrl: fa.supabaseUrl
            });
          }

          console.log(`Saved analysis session ${sessionId} to database`);
        } catch (error) {
          console.error('Failed to save to database:', error);
          // Continue anyway - the analysis is still valid
        }

        // Cleanup temp files
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 98, step: 'cleanup' })}\n\n`));
        await cleanup(framesDir);

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 100, results })}\n\n`));
        clearInterval(heartbeat);
        controller.close();

      } catch (error) {
        console.error('Analysis error:', error);

        let errorMessage = 'Analysis failed';
        if (error instanceof Error) {
          errorMessage = `Error: ${error.message}`;
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`));
        if (heartbeat) clearInterval(heartbeat);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function analyzeAllFramesWithGPT(
  frames: { dataUrl: string; timestamp: number; frameNumber: number }[],
  problem: string,
  dicomMetadata?: { patientName: string; patientID: string; studyDate: string; modality: string }
): Promise<{ overall: Omit<OverallAnalysis, 'frameAnalyses'>; perFrame: FrameAnalysis[] }> {

  // Usage pattern:
  // const ctx = {
  //   patient: { name: "John Doe", id: "MRN123", age: 57, sex: "M", referring: "Dr. Smith" },
  //   study: {
  //     date: "2025-10-23", accession: "ACC-456", modality: "MRI", bodyPart: "Prostate",
  //     examType: "MRI Prostate with and without IV contrast",
  //     institution: "Zemuria Imaging Center", scanner: "3T Siemens Vida",
  //     contrast: { agent: "Gadobutrol", dose: "7.5 mL" },
  //     technique: {
  //       sequencesOrPhases: ["T2 axial/sagittal/coronal", "DWI (b=0/800/1400) with ADC map", "DCE"],
  //       sliceThickness: "3 mm", planes: ["Axial","Sagittal","Coronal"], gating: "None",
  //       limitations: ["Mild motion artifact on DWI"]
  //     },
  //     comparison: { priorDate: "2025-06-10", priorModality: "MRI", intervalChangeHint: "stable" }
  //   },
  //   history: "Elevated PSA; prior negative biopsy; LUTS x 3 months",
  //   risk: { systems: ["PI-RADS"], context: "Screening in at-risk population" },
  //   onc: { onTherapy: false },
  //   // Optional pre-structured lesions (helps determinism + RECIST):
  //   lesions: [
  //     {
  //       id: "L-1", laterality: "Right", site: "PZ midgland", organSegment: "Prostate",
  //       size: "17×12×11 mm", longestDiameter: "17 mm", morphology: "oval, indistinct margins",
  //       signalOrDensity: "T2 hypointense; marked DWI restriction; low ADC",
  //       enhancement: "early focal enhancement on DCE",
  //       relationships: "no extracapsular extension; neurovascular bundles preserved",
  //       complications: "",
  //       recistTarget: true
  //     }
  //     // add more lesions as needed
  //   ]
  // };
  // const prompt = renderRadiologyPrompt(ctx);

  const prompt = `You are an expert radiologist. Infer results from the above images.

Patient history: ${problem || 'Not specified'}

${dicomMetadata?.patientName ? `PATIENT NAME: ${dicomMetadata.patientName}` : ''}
${dicomMetadata?.patientID ? `PATIENT ID: ${dicomMetadata.patientID}` : ''}
${dicomMetadata?.studyDate ? `STUDY DATE: ${dicomMetadata.studyDate.substring(0, 4)}-${dicomMetadata.studyDate.substring(4, 6)}-${dicomMetadata.studyDate.substring(6, 8)}` : ''}
${dicomMetadata?.modality ? `MODALITY: ${dicomMetadata.modality}` : ''}

Analyze these medical images and provide a comprehensive, detailed radiology report.

IMPORTANT INSTRUCTIONS:
- Do NOT include any introductory phrases like "Of course" or "As an expert radiologist"
- Do NOT include headers like "EXPERT RADIOLOGY REPORT"
- Generate a professional, neatly formatted direct medical radiology report with Patient Information, Exam Date, Exam Type, Clinical History, and any other relevant information.
- Do NOT include any educational disclaimers or statements about this being for educational purposes
- Start directly with your medical findings organized under clear section headings (FINDINGS, IMPRESSION, RECOMMENDATION)
- Provide a professional, direct medical report without any preamble or disclaimers

REQUIRED DETAIL LEVEL:
- Provide EXTENSIVE and DETAILED descriptions of all anatomical structures visible
- Describe the SIZE, LOCATION, SIGNAL CHARACTERISTICS, and MORPHOLOGY of any abnormalities in great detail
- Include measurements where applicable (approximate sizes in millimeters or centimeters)
- Describe the relationship of abnormal findings to surrounding structures
- Provide detailed differential diagnosis with explanations for each possibility
- Explain the clinical significance of each finding
- Include systematic review of all visible anatomical structures, even if normal
- Use precise anatomical terminology and be thorough in your descriptions
- The report should be comprehensive and detailed, not brief or summarized
- Aim for at least 3-4 paragraphs in the FINDINGS section with detailed observations

You are analyzing ${frames.length} frame(s) from the medical imaging study. Review all frames systematically.
`;

  // Build OpenAI messages with vision
  const messageContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    { type: "text", text: prompt }
  ];

  // Add all frames as images
  for (const f of frames) {
    messageContent.push({
      type: "image_url",
      image_url: {
        url: f.dataUrl // OpenAI accepts data URLs directly
      }
    });
    messageContent.push({
      type: "text",
      text: `Frame ${f.frameNumber} at ${f.timestamp.toFixed(2)}s`
    });
  }

  const response = await withRetry(
    async () => await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        {
          role: "user",
          content: messageContent as any // Type assertion for OpenAI SDK compatibility
        }
      ],
      // Note: GPT-5 has 128k max output tokens by default, no need to specify max_tokens
    }),
    {
      label: 'all-frames',
      maxRetries: GPT_MAX_RETRIES,
      baseDelayMs: GPT_RETRY_BASE_DELAY_MS,
    }
  );

  const text = response.choices[0]?.message?.content || '';
  const parsed = parseOverallJson(text);
  if (parsed) {
    // Ensure timestamps are present
    const frameMap = new Map(frames.map(f => [f.frameNumber, f.timestamp] as const));
    const per = (parsed.frameAnalyses || []).map((fa: any) => ({
      frameNumber: Number(fa.frameNumber) || 0,
      timestamp: typeof fa.timestamp === 'number' ? fa.timestamp : (frameMap.get(Number(fa.frameNumber)) || 0),
      analysis: String(fa.analysis || ''),
      confidence: Math.max(0, Math.min(1, Number(fa.confidence) || 0.6)),
      findings: Array.isArray(fa.findings) ? fa.findings.map(String) : []
    }));

    const overall = {
      summary: String(parsed.summary || ''),
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String) : [],
      urgency: (parsed.urgency === 'high' || parsed.urgency === 'medium' || parsed.urgency === 'low') ? parsed.urgency as ('high' | 'medium' | 'low') : 'low' as const,
    };

    return { overall, perFrame: per };
  }

  // Fallback if JSON parsing failed
  const urgency = extractUrgency(text);
  const overall = {
    summary: text || 'No analysis generated',
    recommendations: extractRecommendations(text),
    urgency
  };
  return { overall, perFrame: [] };
}

interface ParsedOverallJson {
  summary?: string;
  recommendations?: string[];
  urgency?: string;
  frameAnalyses?: Array<{
    frameNumber?: number;
    timestamp?: number;
    analysis?: string;
    confidence?: number;
    findings?: string[];
  }>;
}

function parseOverallJson(text: string): ParsedOverallJson | null {
  try {
    const direct = JSON.parse(text) as ParsedOverallJson;
    return direct;
  } catch {
    // Ignore parse errors
  }
  // Try to extract JSON block
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = text.slice(start, end + 1);
    try {
      return JSON.parse(candidate) as ParsedOverallJson;
    } catch {
      // Ignore parse errors
    }
  }
  return null;
}

function extractRecommendations(text: string): string[] {
  const recommendations: string[] = [];
  const recSection = text.match(/recommendations?[:\s]*([\s\S]*?)(?:urgency|$)/i);
  if (recSection) {
    const lines = recSection[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && /^[\d\-\*•]/.test(trimmed)) {
        recommendations.push(trimmed.replace(/^[\d\-\*•]\s*/, ''));
      }
    }
  }
  if (recommendations.length === 0) {
    recommendations.push('Follow up with clinician');
    recommendations.push('Consider additional imaging if symptoms persist');
  }
  return recommendations;
}

function extractUrgency(text: string): 'low' | 'medium' | 'high' {
  const t = text.toLowerCase();
  if (t.includes('high') || t.includes('urgent') || t.includes('immediate')) return 'high';
  if (t.includes('medium') || t.includes('moderate')) return 'medium';
  return 'low';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ErrorWithCode {
  code?: string;
  status?: number;
  message?: string;
  cause?: {
    code?: string;
    status?: number;
  };
}

function isRetryableError(error: unknown): { retryable: boolean; reason: string; status?: number } {
  // Known network hiccups or service-side transient errors
  const transientNodeErrors = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'];
  const err = error as ErrorWithCode;
  const code = (err && (err.code || err.cause?.code)) as string | undefined;
  const status = (err && (err.status || err.cause?.status)) as number | undefined;

  if (typeof status === 'number') {
    if (status === 429) return { retryable: true, reason: 'rate_limited', status };
    if (status >= 500) return { retryable: true, reason: 'server_error', status };
  }

  if (code && transientNodeErrors.includes(code)) {
    return { retryable: true, reason: code };
  }

  // Some Google SDK errors wrap details in message
  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('service is currently unavailable') || msg.includes('timeout')) {
    return { retryable: true, reason: 'transient_message', status };
  }

  return { retryable: false, reason: 'non_retryable', status };
}

async function withRetry<T>(fn: () => Promise<T>, opts?: { label?: string; maxRetries?: number; baseDelayMs?: number }): Promise<T> {
  const label = opts?.label || 'gemini-call';
  const maxRetries = Number.isFinite(opts?.maxRetries) ? (opts?.maxRetries as number) : 3;
  const baseDelay = Number.isFinite(opts?.baseDelayMs) ? (opts?.baseDelayMs as number) : 500;

  let attempt = 0;
  // attempts = 1 + maxRetries total tries
  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      const { retryable, reason, status } = isRetryableError(err);
      const isLast = attempt > maxRetries;

      if (!retryable || isLast) {
        if (!retryable) {
          console.error(`[${label}] non-retryable error on attempt ${attempt}:`, { reason, status, message: (err as ErrorWithCode)?.message });
        } else {
          console.error(`[${label}] giving up after ${attempt} attempts`, { reason, status, message: (err as ErrorWithCode)?.message });
        }
        throw err;
      }

      // Exponential backoff with jitter
      const backoff = baseDelay * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * baseDelay);
      const delay = Math.min(backoff + jitter, 10_000); // cap at 10s to keep UX responsive
      console.warn(`[${label}] retrying after transient error`, { attempt, reason, status, delayMs: delay });
      await sleep(delay);
    }
  }
}

async function cleanup(framesDir: string): Promise<void> {
  try {
    console.log(`Cleaning up frames directory: ${framesDir}`);
    const files = await fs.readdir(framesDir);
    for (const file of files) {
      await fs.unlink(path.join(framesDir, file));
    }
    await fs.rmdir(framesDir);
    console.log(`Successfully cleaned up ${files.length} frame files`);
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}
