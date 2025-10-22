import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import formidable from 'formidable';
import fs from 'fs/promises';
import path from 'path';
import { createReadStream } from 'fs';
import VideoProcessor from '@/lib/videoProcessor';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
const GEMINI_MAX_RETRIES = parseInt(process.env.GEMINI_MAX_RETRIES || '3', 10);
const GEMINI_RETRY_BASE_DELAY_MS = parseInt(process.env.GEMINI_RETRY_BASE_DELAY_MS || '500', 10);

interface FrameAnalysis {
  frameNumber: number;
  analysis: string;
  confidence: number;
  findings: string[];
  timestamp?: number;
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
      let heartbeat: any;
      try {
        // Heartbeat to keep SSE connection alive
        heartbeat = setInterval(() => {
          try { controller.enqueue(encoder.encode(`: keep-alive\n\n`)); } catch {}
        }, 15000);
        // Send initial progress
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 10, step: 'received_request' })}\n\n`));

        // Parse the form data
        const formData = await request.formData();
        const videoFile = formData.get('video') as File;
        const problem = (formData.get('problem') as string) || '';

        if (!videoFile) {
          throw new Error('No video file provided');
        }

        // Single problem statement (no patient schema)
        const problemStatement = problem.trim();

        // Create temp directory
        const tempDir = path.join(process.cwd(), 'temp');
        await fs.mkdir(tempDir, { recursive: true });

        // Save uploaded video
        const videoPath = path.join(tempDir, `${Date.now()}_${videoFile.name}`);
        const videoBuffer = await videoFile.arrayBuffer();
        await fs.writeFile(videoPath, Buffer.from(videoBuffer));

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 20, step: 'video_saved' })}\n\n`));

        // Extract frames from video
        const framesDir = path.join(tempDir, `frames_${Date.now()}`);
        await fs.mkdir(framesDir, { recursive: true });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 30, step: 'extracting_frames' })}\n\n`));

        // Get FPS setting from form data (default to 2)
        const fpsString = formData.get('fps') as string;
        const fps = fpsString ? parseInt(fpsString) : 2;

        // Extract frames using our multi-method video processor
        const videoProcessor = new VideoProcessor();
        const extractionResult = await videoProcessor.extractFrames({
          inputPath: videoPath,
          outputDir: framesDir,
          fps: fps
        });

        if (!extractionResult.success) {
          throw new Error(extractionResult.error || 'Frame extraction failed');
        }

        const frameFiles = extractionResult.frames;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 40, step: 'frames_extracted', method: extractionResult.method, frameCount: frameFiles.length })}\n\n`));

        // Read frames and send all to Gemini in a single request
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 60, step: 'preparing_model', mode: 'single-call' })}\n\n`));
        const framesForGemini: { dataUrl: string; frameNumber: number; timestamp: number }[] = [];
        for (let i = 0; i < frameFiles.length; i++) {
          const framePath = frameFiles[i];
          const imageBuffer = await fs.readFile(framePath);
          const base64 = imageBuffer.toString('base64');
          const dataUrl = `data:image/png;base64,${base64}`;
          const timestamp = i / fps; // approximate timestamp
          framesForGemini.push({ dataUrl, frameNumber: i + 1, timestamp });
        }

        const { overall, perFrame } = await analyzeAllFramesWithGemini(framesForGemini, problemStatement);

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 90, step: 'parsing_results' })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 95, step: 'finalizing' })}\n\n`));

        // Cleanup temp files and video processor
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 96, step: 'cleanup' })}\n\n`));
        await cleanup(videoPath, framesDir);
        await videoProcessor.cleanup();

        // Send final results
        const results: OverallAnalysis = {
          ...overall,
          frameAnalyses: perFrame
        };

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 100, results })}\n\n`));
        if (heartbeat) clearInterval(heartbeat);
        controller.close();

      } catch (error) {
        console.error('Analysis error:', error);

        let errorMessage = 'Analysis failed';
        if (error instanceof Error) {
          if (error.message.includes('Frame extraction failed')) {
            errorMessage = 'Video processing failed. This could be due to:\n\n' +
                          '• Unsupported video format (try MP4)\n' +
                          '• Corrupted video file\n' +
                          '• Video too short or too long\n' +
                          '• Network issues during processing\n\n' +
                          'Please try uploading a different video file.';
          } else if (error.message.includes('FFmpeg.js initialization failed')) {
            errorMessage = 'Video processor initialization failed. Please refresh the page and try again.';
          } else {
            errorMessage = `Error: ${error.message}`;
          }
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

// Single-call analysis for all frames together
async function analyzeAllFramesWithGemini(frames: { dataUrl: string; frameNumber: number; timestamp: number }[], problem: string): Promise<{ overall: Omit<OverallAnalysis, 'frameAnalyses'>; perFrame: FrameAnalysis[] }> {
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const prompt = `You are an expert radiologist who must give an expert radiology report of the patient seeing the images of the scan that are attached here and the medical history. Please see them and give an expert report.

PATIENT PROBLEM:
${problem || 'Not specified'}

Return your response in the following JSON format only:
{
  "summary": string,
  "recommendations": string[],
  "urgency": "low" | "medium" | "high",
  "frameAnalyses": [
    { "frameNumber": number, "timestamp": number, "analysis": string, "confidence": number, "findings": string[] }
  ]
}
`;

  const contents: any[] = [{ text: prompt }];
  for (const f of frames) {
    const base64Data = f.dataUrl.split(',')[1];
    const mimeType = f.dataUrl.split(';')[0].split(':')[1] || 'image/png';
    contents.push({ inlineData: { data: base64Data, mimeType } });
    contents.push({ text: `Frame ${f.frameNumber} at ${f.timestamp.toFixed(2)}s` });
  }

  const response = await withRetry(() => model.generateContent(contents), {
    label: 'all-frames-video',
    maxRetries: GEMINI_MAX_RETRIES,
    baseDelayMs: GEMINI_RETRY_BASE_DELAY_MS,
  });

  const text = response.response.text() || '';
  const parsed = parseOverallJson(text);
  if (parsed) {
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
      urgency: (parsed.urgency === 'high' || parsed.urgency === 'medium') ? parsed.urgency : 'low' as const,
    };

    return { overall, perFrame: per };
  }

  const overall = {
    summary: text || 'No analysis generated',
    recommendations: extractRecommendations(text),
    urgency: extractUrgency(text)
  };
  return { overall, perFrame: [] };
}

function parseOverallJson(text: string): any | null {
  try {
    const direct = JSON.parse(text);
    return direct;
  } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = text.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

function extractFindings(text: string): string[] {
  // Simple extraction of key findings from the analysis text
  const findings: string[] = [];

  // Look for bullet points or numbered lists
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^[\d\-\*•]\s*/)) {
      findings.push(trimmed.replace(/^[\d\-\*•]\s*/, ''));
    }
  }

  // If no structured findings found, extract sentences that seem like findings
  if (findings.length === 0) {
    const sentences = text.split(/[.!?]+/);
    for (const sentence of sentences) {
      if (sentence.toLowerCase().includes('visible') ||
          sentence.toLowerCase().includes('shows') ||
          sentence.toLowerCase().includes('appears') ||
          sentence.toLowerCase().includes('indicates')) {
        findings.push(sentence.trim());
      }
    }
  }

  return findings.slice(0, 5); // Limit to top 5 findings
}

function extractConfidence(text: string): number {
  // Look for confidence indicators in the text
  const confidenceRegex = /confidence[:\s]*(\d+(?:\.\d+)?)[%]?/i;
  const match = text.match(confidenceRegex);

  if (match) {
    const value = parseFloat(match[1]);
    return value > 1 ? value / 100 : value;
  }

  // Default confidence based on text content quality
  if (text.length > 200 && !text.includes('error') && !text.includes('unclear')) {
    return 0.8;
  } else if (text.length > 100) {
    return 0.6;
  } else {
    return 0.4;
  }
}

async function generateOverallAnalysis(frameAnalyses: FrameAnalysis[], patientInfo: any = null): Promise<Omit<OverallAnalysis, 'frameAnalyses'>> {
  try {
    const analysisText = frameAnalyses
      .map(frame => `Frame ${frame.frameNumber}: ${frame.analysis}`)
      .join('\n\n');

    // Build patient context if available
    let patientContext = '';
    if (patientInfo) {
      patientContext = `
PATIENT INFORMATION:
- Age: ${patientInfo.age} years old
- Gender: ${patientInfo.gender}
- Presenting Symptoms: ${patientInfo.symptoms}
- Symptom Duration: ${patientInfo.duration || 'Not specified'}
- Symptom Severity: ${patientInfo.severity || 'Not specified'}
- Clinical Indication: ${patientInfo.scanReason}
- Medical History: ${patientInfo.medicalHistory || 'None provided'}
- Current Medications: ${patientInfo.medications || 'None provided'}

`;
    }

    const prompt = `
    ${patientContext}
    Based on the following frame-by-frame analysis of a CT video scan, provide a comprehensive medical summary:

    FRAME ANALYSIS RESULTS:
    ${analysisText}

    Please provide:
    1. A comprehensive summary of the entire scan
    2. Clinical correlation with patient symptoms and history
    3. Clinical recommendations for the patient
    4. Urgency level (low/medium/high) based on findings
    5. Overall assessment and next steps

    Focus on:
    - Consistency across frames
    - Progressive changes throughout the video
    - Clinical significance of findings
    - Correlation with patient's presenting symptoms
    - Patient care recommendations based on clinical context
    ${patientInfo ? '- Specific attention to findings that could explain the patient\'s symptoms' : ''}

    Format your response clearly and professionally.
    `;

    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const overall = await model.generateContent([{ text: prompt }]);
    const overallText = overall.response.text() || 'No overall analysis generated';

    // Parse the response
    const summary = extractSummary(overallText);
    const recommendations = extractRecommendations(overallText);
    const urgency = extractUrgency(overallText);

    return {
      summary,
      recommendations,
      urgency
    };

  } catch (error) {
    console.error('Error generating overall analysis:', error);
    return {
      summary: 'Unable to generate comprehensive analysis. Please review individual frame analyses.',
      recommendations: ['Consult with a radiologist for professional interpretation'],
      urgency: 'medium' as const
    };
  }
}

function extractSummary(text: string): string {
  // Extract the main summary from the analysis
  const summarySection = text.split(/(?:recommendations?|urgency|next steps?)/i)[0];
  return summarySection.trim() || text.substring(0, 300) + '...';
}

function extractRecommendations(text: string): string[] {
  const recommendations: string[] = [];

  // Look for recommendation sections
  const recSection = text.match(/recommendations?[:\s]*([\s\S]*?)(?:urgency|$)/i);
  if (recSection) {
    const lines = recSection[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && trimmed.match(/^[\d\-\*•]\s*/)) {
        recommendations.push(trimmed.replace(/^[\d\-\*•]\s*/, ''));
      }
    }
  }

  if (recommendations.length === 0) {
    recommendations.push('Follow up with healthcare provider');
    recommendations.push('Consider additional imaging if symptoms persist');
  }

  return recommendations;
}

function extractUrgency(text: string): 'low' | 'medium' | 'high' {
  const urgencyText = text.toLowerCase();

  if (urgencyText.includes('high') || urgencyText.includes('urgent') || urgencyText.includes('immediate')) {
    return 'high';
  } else if (urgencyText.includes('medium') || urgencyText.includes('moderate')) {
    return 'medium';
  } else {
    return 'low';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: any): { retryable: boolean; reason: string; status?: number } {
  const transientNodeErrors = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'];
  const code = (error && (error.code || error.cause?.code)) as string | undefined;
  const status = (error && (error.status || error.cause?.status)) as number | undefined;

  if (typeof status === 'number') {
    if (status === 429) return { retryable: true, reason: 'rate_limited', status };
    if (status >= 500) return { retryable: true, reason: 'server_error', status };
  }

  if (code && transientNodeErrors.includes(code)) {
    return { retryable: true, reason: code };
  }

  const msg = String(error?.message || '').toLowerCase();
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
  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      const { retryable, reason, status } = isRetryableError(err);
      const isLast = attempt > maxRetries;

      if (!retryable || isLast) {
        if (!retryable) {
          console.error(`[${label}] non-retryable error on attempt ${attempt}:`, { reason, status, message: (err as any)?.message });
        } else {
          console.error(`[${label}] giving up after ${attempt} attempts`, { reason, status, message: (err as any)?.message });
        }
        throw err;
      }

      const backoff = baseDelay * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * baseDelay);
      const delay = Math.min(backoff + jitter, 10_000);
      console.warn(`[${label}] retrying after transient error`, { attempt, reason, status, delayMs: delay });
      await sleep(delay);
    }
  }
}

async function cleanup(videoPath: string, framesDir: string): Promise<void> {
  try {
    await fs.unlink(videoPath);
    const files = await fs.readdir(framesDir);
    for (const file of files) {
      await fs.unlink(path.join(framesDir, file));
    }
    await fs.rmdir(framesDir);
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}
