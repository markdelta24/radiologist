'use client';

import { useState, useRef } from 'react';
import { ClientVideoProcessor } from '@/lib/clientVideoProcessor';

interface ProblemInfo {
  problem: string;
}

interface AnalysisResults {
  summary?: string;
  recommendations?: string[];
  urgency?: 'low' | 'medium' | 'high';
}

interface VideoUploadProps {
  onAnalysisStart: () => void;
  onAnalysisComplete: (results: AnalysisResults | null) => void;
  onBack?: () => void;
  isAnalyzing: boolean;
  problemInfo?: ProblemInfo | null;
}

export default function VideoUpload({ onAnalysisStart, onAnalysisComplete, onBack, isAnalyzing, problemInfo }: VideoUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fps = 5; // Fixed at 5 FPS
  const [steps, setSteps] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFile(files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      handleFile(files[0]);
    }
  };

  const validateFile = (file: File): { valid: boolean; error?: string } => {
    const validTypes = ['video/mp4', 'video/avi', 'video/mov', 'video/wmv'];
    const maxSize = 100 * 1024 * 1024; // 100MB

    if (!validTypes.includes(file.type)) {
      return { valid: false, error: 'Please upload a valid video file (MP4, AVI, MOV, WMV)' };
    }

    if (file.size > maxSize) {
      return { valid: false, error: 'File size must be less than 100MB' };
    }

    return { valid: true };
  };

  const handleFile = async (file: File) => {
    const validation = validateFile(file);
    if (!validation.valid) {
      alert(validation.error);
      return;
    }

    onAnalysisStart();
    setUploadProgress(0);

    try {
      // Extract frames on client side
      setUploadProgress(10);
      const videoProcessor = new ClientVideoProcessor();

      setUploadProgress(20);
      const frames = await videoProcessor.extractFrames(file, {
        fps,
        maxFrames: Math.min(fps * 30, 200) // Limit frames based on FPS
      });

      setUploadProgress(40);
      console.log(`Extracted ${frames.length} frames`);

      // Prepare form data with extracted frames
      const formData = new FormData();
      formData.append('frameCount', frames.length.toString());
      formData.append('fps', fps.toString());

      // Add each frame as base64 data
      frames.forEach((frame, index) => {
        formData.append(`frame_${index}`, frame.dataUrl);
        formData.append(`timestamp_${index}`, frame.timestamp.toString());
      });

      // Include problem statement if available
      if (problemInfo?.problem) {
        formData.append('problem', problemInfo.problem);
      }

      setUploadProgress(50);

      // Send to server for AI analysis
      const response = await fetch('/api/analyze-frames', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Analysis failed');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentStep: string | undefined;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Try to process any trailing buffered line
            const trailing = buffer.trim();
            if (trailing.startsWith('data: ')) {
              try {
                const jsonString = trailing.slice(6).trim();
                if (jsonString) {
                  const data = JSON.parse(jsonString);
                  if (data.results) {
                    onAnalysisComplete(data.results);
                    setUploadProgress(100);
                  }
                }
              } catch (e) {
                console.error('Error parsing trailing SSE data:', e, 'Line:', trailing);
              }
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Process complete lines; keep remainder in buffer
          let newlineIndex = buffer.indexOf('\n');
          while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
            buffer = buffer.slice(newlineIndex + 1);
            newlineIndex = buffer.indexOf('\n');

            if (line.startsWith('data: ')) {
              try {
                const jsonString = line.slice(6).trim();
                if (!jsonString) continue;

                const data = JSON.parse(jsonString);
                if (data.progress !== undefined) {
                  // Map server progress (50-100) to our range (50-100)
                  const adjustedProgress = 50 + (data.progress / 100) * 50;
                  setUploadProgress(adjustedProgress);
                }
                if (data.step && data.step !== currentStep) {
                  currentStep = data.step;
                  setSteps(prev => {
                    if (prev[prev.length - 1] === data.step) return prev;
                    return [...prev, data.step];
                  });
                }
                if (data.results) {
                  onAnalysisComplete(data.results);
                  setUploadProgress(100);
                  setSteps(prev => [...prev, 'completed']);
                }
                if (data.error) {
                  alert(`Error: ${data.error}`);
                  onAnalysisComplete(null);
                  setUploadProgress(0);
                  setSteps(prev => [...prev, 'error']);
                }
              } catch (e) {
                console.error('Error parsing SSE data:', e, 'Line:', line);
              }
            }
          }
        }
      }

      // Cleanup
      videoProcessor.cleanup();

    } catch (error) {
      console.error('Processing error:', error);
      alert(`Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      onAnalysisComplete(null);
      setUploadProgress(0);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full space-y-4">
      {/* FPS Configuration removed - fixed at 5 FPS */}

      <div
        className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
        } ${isAnalyzing ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleFileInput}
          className="hidden"
          disabled={isAnalyzing}
        />

        {!isAnalyzing ? (
          <>
            <div className="mx-auto w-12 h-12 text-gray-400 mb-4">
              <svg fill="none" stroke="currentColor" viewBox="0 0 48 48">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Upload Video
            </h3>
            <p className="text-gray-600 mb-4">
              Drag and drop your 15-20 second CT video here, or click to browse
            </p>
            <p className="text-sm text-gray-500">
              Supports MP4, AVI, MOV, WMV (max 100MB)
            </p>
          </>
        ) : (
          <div className="space-y-4">
            <div className="mx-auto w-12 h-12 text-blue-500 animate-spin">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900">
              Processing Video...
            </h3>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <div className="text-sm text-gray-600 space-y-1">
              {steps.map((s, idx) => (
                <div key={idx} className="flex items-center">
                  <span className="w-2 h-2 rounded-full bg-blue-500 mr-2" />
                  <span>{s.replaceAll('_', ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Back Button */}
      {onBack && !isAnalyzing && (
        <div className="mt-4 text-center">
          <button
            onClick={onBack}
            className="px-6 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            ← Back to Patient Info
          </button>
        </div>
      )}
    </div>
  );
}
