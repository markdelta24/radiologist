import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import path from 'path';
import { uploadFrameToSupabase, saveAnalysisSession, saveAnalysisFrame } from '@/lib/supabase';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
const GEMINI_MAX_RETRIES = parseInt(process.env.GEMINI_MAX_RETRIES || '3', 10);
const GEMINI_RETRY_BASE_DELAY_MS = parseInt(process.env.GEMINI_RETRY_BASE_DELAY_MS || '500', 10);

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

        // Analyze all frames in a single Gemini call
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 30, step: 'preparing_model', mode: 'single-call' })}\n\n`));
        const { overall, perFrame } = await analyzeAllFramesWithGemini(frames, problemStatement, dicomMetadata);

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

async function analyzeAllFramesWithGemini(
  frames: { dataUrl: string; timestamp: number; frameNumber: number }[],
  problem: string,
  dicomMetadata?: { patientName: string; patientID: string; studyDate: string; modality: string }
): Promise<{ overall: Omit<OverallAnalysis, 'frameAnalyses'>; perFrame: FrameAnalysis[] }> {
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

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

  // First, analyze images to extract study metadata
  const metadataAnalysisPrompt = `Analyze these medical images and extract the following metadata in JSON format:

{
  "modality": "CT/MRI/X-Ray/Ultrasound/etc",
  "bodyPart": "specific anatomical region (e.g., Brain, Chest, Abdomen, Pelvis, Spine, etc.)",
  "examType": "full exam description (e.g., CT Chest with IV contrast, MRI Brain without contrast)",
  "hasContrast": true/false,
  "planes": ["Axial", "Sagittal", "Coronal"] or [],
  "sequences": ["T1", "T2", "FLAIR", "DWI"] or [] for MRI, empty for CT
}

Analyze the image characteristics to determine modality and anatomy. Respond ONLY with valid JSON, no other text.

Clinical context from user: ${problem || 'Not specified'}`;

  const metadataParts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [{ text: metadataAnalysisPrompt }];

  // Add first few frames for metadata detection (don't need all frames)
  const frameSample = frames.slice(0, Math.min(5, frames.length));
  for (const f of frameSample) {
    const base64Data = f.dataUrl.split(',')[1];
    const mimeType = f.dataUrl.split(';')[0].split(':')[1] || 'image/png';
    metadataParts.push({ inlineData: { data: base64Data, mimeType } });
  }

  let studyMetadata = {
    modality: "",
    bodyPart: "",
    examType: "",
    hasContrast: false,
    planes: [] as string[],
    sequences: [] as string[]
  };

  try {
    const metadataResponse = await withRetry(() => model.generateContent(metadataParts as any), {
      label: 'metadata-extraction',
      maxRetries: GEMINI_MAX_RETRIES,
      baseDelayMs: GEMINI_RETRY_BASE_DELAY_MS,
    });
    const metadataText = metadataResponse.response.text() || '';
    const metadataJson = parseOverallJson(metadataText) as any;
    if (metadataJson) {
      studyMetadata = {
        modality: String(metadataJson.modality || ""),
        bodyPart: String(metadataJson.bodyPart || ""),
        examType: String(metadataJson.examType || ""),
        hasContrast: Boolean(metadataJson.hasContrast),
        planes: Array.isArray(metadataJson.planes) ? metadataJson.planes.map(String) : [],
        sequences: Array.isArray(metadataJson.sequences) ? metadataJson.sequences.map(String) : []
      };
    }
  } catch (error) {
    console.error('Failed to extract metadata, using defaults:', error);
  }

  // Helper function to format DICOM date (YYYYMMDD -> YYYY-MM-DD)
  const formatDicomDate = (dicomDate: string): string => {
    if (!dicomDate || dicomDate.length !== 8) return '';
    return `${dicomDate.substring(0, 4)}-${dicomDate.substring(4, 6)}-${dicomDate.substring(6, 8)}`;
  };

  // Context object for the radiology prompt
  const ctx = {
    patient: {
      name: dicomMetadata?.patientName || "",
      id: dicomMetadata?.patientID || "",
      age: "",
      sex: "",
      referring: ""
    },
    study: {
      date: dicomMetadata?.studyDate ? formatDicomDate(dicomMetadata.studyDate) : new Date().toISOString().split('T')[0],
      accession: "",
      modality: dicomMetadata?.modality || studyMetadata.modality,
      bodyPart: studyMetadata.bodyPart,
      examType: studyMetadata.examType || `${dicomMetadata?.modality || studyMetadata.modality} ${studyMetadata.bodyPart}${studyMetadata.hasContrast ? ' with IV contrast' : ' without contrast'}`.trim(),
      institution: "",
      scanner: "",
      contrast: studyMetadata.hasContrast ? { agent: "", dose: "" } : { agent: "", dose: "" },
      technique: {
        sequencesOrPhases: studyMetadata.sequences.length > 0 ? studyMetadata.sequences : [],
        sliceThickness: "",
        planes: studyMetadata.planes,
        gating: "",
        limitations: []
      },
      comparison: { priorDate: "", priorModality: "", intervalChangeHint: "" }
    },
    history: problem || 'Not specified',
    risk: { systems: [], context: "" },
    onc: { onTherapy: false },
    lesions: []
  };

  const renderRadiologyPrompt = (ctx: any = {}) => `
You are generating a FINAL diagnostic radiology report with the precision and authority of a board-certified subspecialty radiologist. This is a SIGNED, FINAL report for the medical record. The output must be structurally exact, clinically precise, and free of any hedging language or disclaimers.

INPUT OBJECT (context):
- Patient, study, history, risk, therapy, and lesion data may be provided as variables.
- If a variable is missing or empty, OMIT its line entirely (do NOT print "None"), EXCEPT:
  • Comparison: if absent, print "No prior studies available."
  • Where a classification system is applicable but data is incomplete, assign the LOWEST CONFIDENT category and include a single-sentence rationale.
- Maintain the exact section order and formatting below.

🚨 ABSOLUTE RULES (MANDATORY)
- NO hedging, NO disclaimers, NO phrases like: "could be," "may represent," "might," "appears," "suggests," "likely," "probably," "consider," "correlate clinically," "recommend correlation," "if clinically indicated," "in keeping with," "consistent with."
- NO preambles, apologies, or meta-comments.
- State ONE SINGLE MOST LIKELY PRIMARY DIAGNOSIS in the Impression, with staging/classification where applicable.
- Technique limitations may be stated ONLY in the Technique section, without hedging language.
- If prior is referenced, state interval change explicitly (increased/decreased/stable) with measurements.
- AUTO-APPLY classifications when relevant: BI-RADS, LI-RADS, PI-RADS, Lung-RADS, TI-RADS, O-RADS, Bosniak (2019), TNM (AJCC), RECIST 1.1, ASPECTS, ICH (ABC/2).
- For oncology/multi-lesion exams: enforce laterality + **Lesion ID numbering (L-1, L-2, …)**, and RECIST target vs non-target tracking.

🧱 VALIDATION & CONSISTENCY
- Sections present and in order; modality/technique/findings are coherent.
- Measurements match between Findings and Impression.
- Classification/staging rationale matches criteria.
- Banned words do not appear.
- If your draft violates any rule, silently self-correct and output only the compliant report.

OUTPUT FORMAT (MUST MATCH EXACTLY)

IMPORTANT FORMATTING RULES:
- Each section heading (Patient Information, Exam Date, etc.) MUST start on a NEW LINE
- Add a blank line before each section heading
- Section headings should be followed by a colon
- Content should start on the next line after the heading

Patient Information:
${ctx.patient?.name ? `- Name: ${ctx.patient.name}` : ""}${ctx.patient?.id ? `\n- ID: ${ctx.patient.id}` : ""}${(ctx.patient?.age && ctx.patient?.sex) ? `\n- Age/Sex: ${ctx.patient.age}/${ctx.patient.sex}` : ""}${ctx.patient?.referring ? `\n- Referring Physician: ${ctx.patient.referring}` : ""}

Exam Date:
${ctx.study?.date ? `- ${ctx.study.date}` : ""}

Exam Type:
${ctx.study?.examType || [ctx.study?.modality, ctx.study?.bodyPart, ctx.study?.contrast?.agent ? "with IV contrast" : ""].filter(Boolean).join(" ") || ""}

Clinical History:
${ctx.history || ""}

Technique:
${[
  ctx.study?.institution ? `- Institution: ${ctx.study.institution}` : "",
  ctx.study?.scanner ? `- Scanner: ${ctx.study.scanner}` : "",
  ctx.study?.contrast?.agent ? `- Contrast: ${ctx.study.contrast.agent}${ctx.study?.contrast?.dose ? `, ${ctx.study.contrast.dose}` : ""}` : "",
  Array.isArray(ctx.study?.technique?.sequencesOrPhases) && ctx.study.technique.sequencesOrPhases.length ? `- Sequences/Phases: ${ctx.study.technique.sequencesOrPhases.join("; ")}` : "",
  ctx.study?.technique?.sliceThickness ? `- Slice thickness: ${ctx.study.technique.sliceThickness}` : "",
  Array.isArray(ctx.study?.technique?.planes) && ctx.study.technique.planes.length ? `- Planes: ${ctx.study.technique.planes.join(", ")}` : "",
  ctx.study?.technique?.gating ? `- Gating: ${ctx.study.technique.gating}` : "",
  Array.isArray(ctx.study?.technique?.limitations) && ctx.study.technique.limitations.length ? `- Limitations: ${ctx.study.technique.limitations.join("; ")}` : ""
].filter(Boolean).join("\n")}

Comparison:
${ctx.study?.comparison?.priorDate
  ? `- Prior study: ${ctx.study.comparison.priorModality || "Imaging"} on ${ctx.study.comparison.priorDate}; interval change: ${ctx.study.comparison.intervalChangeHint || "state precisely in Findings"}`
  : `- No prior studies available.`}

Findings:
${
(() => {
  // Compose systematic findings with lesion framework
  const blocks = [];

  // Systematic normal/overview line (leave model room to expand organ-by-organ)
  blocks.push(`- Systematic review performed for ${[ctx.study?.modality, ctx.study?.bodyPart].filter(Boolean).join(" ")}. Unless stated, major visualized structures are without acute abnormality.`);

  // Lesion list (RECIST-friendly), with laterality + ID numbering
  if (Array.isArray(ctx.lesions) && ctx.lesions.length) {
    blocks.push(`Lesions:`);
    ctx.lesions.forEach((l: any) => {
      const tag = l.recistTarget ? "[Target]" : "[Non-target]";
      const parts = [
        `${tag} ${l.id}: ${[l.laterality, l.site].filter(Boolean).join(" ")}${l.organSegment ? `, ${l.organSegment}` : ""}`,
        l.size ? `Size: ${l.size}${l.longestDiameter ? ` (LD ${l.longestDiameter})` : ""}` : "",
        l.morphology ? `Morphology: ${l.morphology}` : "",
        l.signalOrDensity ? `Signal/Density: ${l.signalOrDensity}` : "",
        l.enhancement ? `Enhancement: ${l.enhancement}` : "",
        l.relationships ? `Relations: ${l.relationships}` : "",
        l.complications ? `Complications: ${l.complications}` : ""
      ].filter(Boolean);
      blocks.push(`  • ${parts.join(" | ")}`);
    });

    // RECIST sums if any targets
    const targets = ctx.lesions.filter((l: any) => l.recistTarget && l.longestDiameter);
    if (targets.length) {
      // Sum LD is indicative; actual numeric sum should be computed by the model if strings vary.
      blocks.push(`RECIST 1.1: Target lesions identified (${targets.map((t: any) => `${t.id} LD ${t.longestDiameter}`).join(", ")}); report sum of longest diameters in mm.`);
    }
  } else {
    blocks.push(`- No discrete focal lesions pre-listed in context. Identify and enumerate any detected lesions with IDs (L-1, L-2, …) and laterality.`);
  }

  // RADS hooks — instruct model to apply when relevant
  blocks.push(`- Apply applicable classification systems with explicit criteria references in text (e.g., "meets PI-RADS 4 due to focal markedly hypointense ADC with focal early enhancement").`);

  return blocks.join("\n");
})()
}

Impression:
- Provide ONE definitive primary diagnosis that best explains the imaging and clinical picture.
- Include applicable classification/staging (e.g., PI-RADS category, BI-RADS, LI-RADS, Lung-RADS, TI-RADS, O-RADS, Bosniak 2019, TNM stage, RECIST response).
- If a classification is applicable but data is insufficient, assign the lowest confident category with a one-sentence rationale.
- Include acuity/severity and a concise justification (1–2 sentences).
- Ensure measurements referenced here match the Findings section.

Recommendation:
- Provide directive next steps only (e.g., "Proceed with targeted biopsy," "Schedule MRI liver with gadoxetate in 3 months," "Urgent neurosurgical consult.").
- Specify exact modality, protocol, and timeframe for any follow-up.
- Use imperative language; no hedging verbs.

BANNED WORDS/PHRASES:
"could", "may", "might", "appears", "suggests", "likely", "possibly", "probably", "consider", "correlate clinically", "recommend correlation", "if clinically indicated", "in keeping with", "consistent with", "may represent", "suggestive of", "uncertain significance", any disclaimers.

🚨 FINAL COMPLIANCE ENFORCEMENT
If your draft includes hedging, banned words, missing sections, or structural deviation, automatically self-correct silently and output only the fully compliant final report in the exact format above.

Frame Information:
You are analyzing ${frames.length} frame(s) from the medical imaging study. Review all frames systematically.
`;

  const prompt = renderRadiologyPrompt(ctx);

  const contents: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [{ text: prompt }];
  for (const f of frames) {
    const base64Data = f.dataUrl.split(',')[1];
    const mimeType = f.dataUrl.split(';')[0].split(':')[1] || 'image/png';
    contents.push({ inlineData: { data: base64Data, mimeType } });
    contents.push({ text: `Frame ${f.frameNumber} at ${f.timestamp.toFixed(2)}s` });
  }

  const response = await withRetry(() => model.generateContent(contents), {
    label: 'all-frames',
    maxRetries: GEMINI_MAX_RETRIES,
    baseDelayMs: GEMINI_RETRY_BASE_DELAY_MS,
  });

  const text = response.response.text() || '';
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
