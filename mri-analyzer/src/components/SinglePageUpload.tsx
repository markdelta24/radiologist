'use client';

import { useState, useRef } from 'react';
import { ClientVideoProcessor } from '@/lib/clientVideoProcessor';
import { DicomProcessor } from '@/lib/dicomProcessor';
import { uploadVideoToSupabase, uploadDicomFilesToSupabase } from '@/lib/supabase';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';

interface SinglePageUploadProps {
  onAnalysisStart: () => void;
  onAnalysisComplete: (results: any) => void;
  isAnalyzing: boolean;
}

export default function SinglePageUpload({ onAnalysisStart, onAnalysisComplete, isAnalyzing }: SinglePageUploadProps) {
  const [uploadMode, setUploadMode] = useState<'video' | 'dicom'>('video');
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [problem, setProblem] = useState('');
  const [steps, setSteps] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dicomFiles, setDicomFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dicomInputRef = useRef<HTMLInputElement>(null);
  const fps = 5; // Fixed at 5 FPS

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
    if (files && files.length > 0) {
      if (uploadMode === 'video') {
        setSelectedFile(files[0]);
      } else {
        // DICOM mode - accept multiple files
        const fileArray = Array.from(files).filter(file =>
          file.name.endsWith('.dcm') || file.name.endsWith('.dicom')
        );
        setDicomFiles(fileArray);
      }
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      if (uploadMode === 'video') {
        setSelectedFile(files[0]);
      } else {
        // DICOM mode - accept multiple files
        const fileArray = Array.from(files);
        setDicomFiles(fileArray);
      }
    }
  };

  const handleDicomClick = () => {
    if (!isAnalyzing) {
      dicomInputRef.current?.click();
    }
  };

  const handleClearDicomFiles = () => {
    setDicomFiles([]);
  };

  const handleClearVideoFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getTotalFileSize = (files: File[]): string => {
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const totalMB = totalBytes / (1024 * 1024);
    return totalMB.toFixed(2);
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

  const handleProceed = async () => {
    // Validate based on upload mode
    if (uploadMode === 'video') {
      if (!selectedFile) {
        alert('Please select a video file first');
        return;
      }
      const validation = validateFile(selectedFile);
      if (!validation.valid) {
        alert(validation.error);
        return;
      }
    } else {
      if (dicomFiles.length === 0) {
        alert('Please select DICOM files first');
        return;
      }
    }

    if (!problem.trim()) {
      alert('Please describe the clinical problem or question');
      return;
    }

    onAnalysisStart();
    setUploadProgress(0);
    setSteps([]);

    try {
      const formData = new FormData();
      formData.append('uploadMode', uploadMode);
      formData.append('problem', problem.trim());

      if (uploadMode === 'video') {
        // VIDEO MODE PROCESSING
        setUploadProgress(5);
        setSteps(['Uploading video to Supabase Storage']);
        const timestamp = Date.now();
        const fileName = `${timestamp}-${selectedFile!.name}`;
        const { path: videoPath, url: videoUrl } = await uploadVideoToSupabase(selectedFile!, fileName);

        setUploadProgress(10);
        setSteps(prev => [...prev, 'Video uploaded successfully']);
        console.log(`Video uploaded to Supabase: ${videoUrl}`);

        // Extract frames on client side
        setSteps(prev => [...prev, 'Extracting frames from video']);
        const videoProcessor = new ClientVideoProcessor();

        setUploadProgress(20);
        const frames = await videoProcessor.extractFrames(selectedFile!, {
          fps,
          maxFrames: Math.min(fps * 30, 200)
        });

        setUploadProgress(40);
        setSteps(prev => [...prev, `Extracted ${frames.length} frames`]);

        formData.append('frameCount', frames.length.toString());
        formData.append('fps', fps.toString());
        formData.append('videoUrl', videoUrl);
        formData.append('videoPath', videoPath);

        frames.forEach((frame, index) => {
          formData.append(`frame_${index}`, frame.dataUrl);
          formData.append(`timestamp_${index}`, frame.timestamp.toString());
        });

        // Cleanup video processor
        videoProcessor.cleanup();
      } else {
        // DICOM MODE PROCESSING
        setUploadProgress(5);
        setSteps(['Uploading DICOM files to Supabase Storage']);

        const timestamp = Date.now();
        const patientID = `patient-${timestamp}`;
        const folderName = `dicom/${patientID}`;

        // Upload DICOM files to Supabase Storage
        const uploadedFiles = await uploadDicomFilesToSupabase(dicomFiles, folderName);

        setUploadProgress(15);
        setSteps(prev => [...prev, `Uploaded ${uploadedFiles.length} files to storage`]);

        // Process DICOM files
        setSteps(prev => [...prev, 'Processing DICOM files']);
        const dicomProcessor = new DicomProcessor();

        const processedDicom = await dicomProcessor.processFiles(dicomFiles);

        setUploadProgress(30);
        setSteps(prev => [...prev, `Processed ${processedDicom.length} images`]);

        // Add storage info to form data
        formData.append('dicomFolder', folderName);
        formData.append('frameCount', processedDicom.length.toString());
        formData.append('modality', processedDicom[0]?.metadata.modality || 'DICOM');
        formData.append('patientID', processedDicom[0]?.metadata.patientID || patientID);

        // Add URLs of uploaded files
        uploadedFiles.forEach((file, index) => {
          formData.append(`dicomUrl_${index}`, file.url);
          formData.append(`dicomPath_${index}`, file.path);
        });

        // Add processed images and metadata
        processedDicom.forEach((dicom, index) => {
          formData.append(`frame_${index}`, dicom.imageDataUrl);
          formData.append(`metadata_${index}`, JSON.stringify(dicom.metadata));
          formData.append(`fileName_${index}`, dicom.fileName);
        });

        setUploadProgress(40);
      }

      setUploadProgress(50);
      setSteps(prev => [...prev, 'Sending for AI analysis']);

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

    } catch (error) {
      console.error('Processing error:', error);
      alert(`Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      onAnalysisComplete(null);
      setUploadProgress(0);
    }
  };

  const handleClick = () => {
    if (!isAnalyzing) {
      fileInputRef.current?.click();
    }
  };

  return (
    <Card className="space-y-4 sm:space-y-6">
      <CardContent className="pt-4 sm:pt-6 space-y-4 sm:space-y-6 px-3 sm:px-6">
        {/* Upload Mode Tabs */}
        <Tabs defaultValue="video" className="w-full" onValueChange={(value) => setUploadMode(value as 'video' | 'dicom')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="video" className="text-sm sm:text-base">Video Upload</TabsTrigger>
            <TabsTrigger value="dicom" className="text-sm sm:text-base">DICOM Files</TabsTrigger>
          </TabsList>

          {/* Video Upload Tab */}
          <TabsContent value="video" className="space-y-4 mt-4">
            <div
              className={`relative border-2 border-dashed rounded-lg p-4 sm:p-6 md:p-8 text-center transition-colors ${
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
              <div className="mx-auto w-10 h-10 sm:w-12 sm:h-12 text-gray-400 mb-3 sm:mb-4">
                <svg fill="none" stroke="currentColor" viewBox="0 0 48 48">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                  />
                </svg>
              </div>
              <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2 px-2 break-words">
                {selectedFile ? selectedFile.name : 'Upload Video'}
              </h3>
              <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4 px-2">
                {selectedFile ? 'File selected - ready to proceed' : 'Drag and drop your CT video here, or click to browse'}
              </p>
              <p className="text-xs sm:text-sm text-gray-500 px-2">
                Supports MP4, AVI, MOV, WMV (max 100MB)
              </p>

              {/* Clear button for selected video */}
              {selectedFile && (
                <div className="mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearVideoFile();
                    }}
                    className="text-xs"
                  >
                    Clear Video
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3 sm:space-y-4">
              <div className="flex justify-center">
                <Spinner className="w-10 h-10 sm:w-12 sm:h-12" />
              </div>
              <h3 className="text-base sm:text-lg font-medium text-gray-900 px-2">
                Processing Video...
              </h3>
              <Progress value={uploadProgress} className="w-full" />
              <div className="text-xs sm:text-sm text-gray-600 space-y-2 px-2">
                {steps.map((s, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {s.replaceAll('_', ' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
            </div>
          </TabsContent>

          {/* DICOM Upload Tab */}
          <TabsContent value="dicom" className="space-y-4 mt-4">
            <div
              className={`relative border-2 border-dashed rounded-lg p-4 sm:p-6 md:p-8 text-center transition-colors ${
                dragActive
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 hover:border-gray-400'
              } ${isAnalyzing ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={handleDicomClick}
            >
              <input
                ref={dicomInputRef}
                type="file"
                accept=".dcm,.dicom"
                multiple
                onChange={handleFileInput}
                className="hidden"
                disabled={isAnalyzing}
              />

              {!isAnalyzing ? (
                <>
                  <div className="mx-auto w-10 h-10 sm:w-12 sm:h-12 text-gray-400 mb-3 sm:mb-4">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 48 48">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                      />
                    </svg>
                  </div>
                  <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2 px-2">
                    {dicomFiles.length > 0 ? `${dicomFiles.length} DICOM files selected` : 'Upload DICOM Files'}
                  </h3>
                  <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4 px-2">
                    {dicomFiles.length > 0
                      ? 'Files selected - ready to proceed'
                      : 'Drag and drop DICOM files or folder here, or click to browse'}
                  </p>
                  <p className="text-xs sm:text-sm text-gray-500 px-2">
                    Supports .dcm, .dicom files (multiple files or folders)
                  </p>

                  {/* Display selected DICOM files */}
                  {dicomFiles.length > 0 && (
                    <div className="mt-4 sm:mt-6 text-left border-t pt-3 sm:pt-4 px-2">
                      <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-3 gap-2">
                        <div>
                          <p className="text-xs sm:text-sm font-semibold text-gray-800">
                            Selected Files: {dicomFiles.length}
                          </p>
                          <p className="text-xs text-gray-500">
                            Total size: {getTotalFileSize(dicomFiles)} MB
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClearDicomFiles();
                          }}
                          className="text-xs"
                        >
                          Clear All
                        </Button>
                      </div>
                      <ScrollArea className="h-32 w-full rounded border bg-gray-50 p-2">
                        <div className="space-y-1">
                          {dicomFiles.map((file, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between text-xs py-1 px-2 hover:bg-gray-100 rounded"
                            >
                              <span className="truncate flex-1 text-gray-700">
                                {file.name}
                              </span>
                              <Badge variant="secondary" className="ml-2 text-xs">
                                {(file.size / 1024).toFixed(1)} KB
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex justify-center">
                    <Spinner className="w-10 h-10 sm:w-12 sm:h-12" />
                  </div>
                  <h3 className="text-base sm:text-lg font-medium text-gray-900 px-2">
                    Processing DICOM Files...
                  </h3>
                  <Progress value={uploadProgress} className="w-full" />
                  <div className="text-xs sm:text-sm text-gray-600 space-y-2 px-2">
                    {steps.map((s, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {s.replaceAll('_', ' ')}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Problem Input Section */}
        <div>
        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
          Clinical Problem / Question *
        </label>
        <textarea
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          className="w-full px-3 py-2 text-sm sm:text-base border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-20 sm:h-24"
          placeholder="e.g., Persistent chest pain and shortness of breath; rule out pulmonary embolism or mass."
          disabled={isAnalyzing}
          />
        </div>

        {/* Proceed Button */}
        <div className="text-center">
        <Button
          onClick={handleProceed}
          disabled={
            isAnalyzing ||
            !problem.trim() ||
            (uploadMode === 'video' ? !selectedFile : dicomFiles.length === 0)
          }
          size="lg"
          className="px-6 sm:px-8 text-sm sm:text-base w-full sm:w-auto"
        >
          {isAnalyzing ? 'Processing...' : 'Proceed with Analysis'}
        </Button>
        </div>
      </CardContent>
    </Card>
  );
}
