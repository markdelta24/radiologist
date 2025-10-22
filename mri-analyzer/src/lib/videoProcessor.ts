import fs from 'fs/promises';
import path from 'path';
import cv from '@techstark/opencv-js';

interface VideoProcessorOptions {
  fps?: number;
  outputDir: string;
  inputPath: string;
}

interface FrameExtractionResult {
  success: boolean;
  frames: string[];
  method: string;
  error?: string;
}

export class VideoProcessor {
  constructor() {}

  async extractFrames(options: VideoProcessorOptions): Promise<FrameExtractionResult> {
    const { fps = 2, outputDir, inputPath } = options;

    // Try multiple methods in order of preference
    const methods = [
      () => this.extractWithOpenCV(inputPath, outputDir, fps),
      () => this.extractWithVideoThumbnail(inputPath, outputDir, fps),
      () => this.extractWithFFmpegExtract(inputPath, outputDir, fps),
    ];

    for (const method of methods) {
      try {
        const result = await method();
        if (result.success) {
          return result;
        }
      } catch (error) {
        console.warn('Video extraction method failed, trying next...', error);
        continue;
      }
    }

    return {
      success: false,
      frames: [],
      method: 'none',
      error: 'All frame extraction methods failed. Please ensure video file is valid.',
    };
  }

  private async extractWithOpenCV(
    inputPath: string,
    outputDir: string,
    fps: number
  ): Promise<FrameExtractionResult> {
    try {
      // Initialize OpenCV if not already done
      if (!cv.Mat) {
        await new Promise((resolve) => {
          cv.onRuntimeInitialized = resolve;
        });
      }

      const frameFiles: string[] = [];

      // Read video file
      const videoBuffer = await fs.readFile(inputPath);

      // Create video capture
      const cap = new cv.VideoCapture();
      const mat = new cv.Mat();

      // Try to open video from buffer
      // Note: OpenCV.js might have limitations with video files in Node.js
      // This is a simplified approach
      let frameCount = 0;
      const maxFrames = 200; // Safety limit

      for (let i = 0; i < maxFrames && frameCount < 50; i++) {
        try {
          // This is a simplified frame extraction
          // In practice, OpenCV video reading in Node.js is complex
          const outputPath = path.join(outputDir, `frame_${String(frameCount + 1).padStart(3, '0')}.png`);

          // For now, we'll mark this as a placeholder and fall back to other methods
          throw new Error('OpenCV video processing not fully implemented for Node.js environment');

        } catch (frameError) {
          break;
        }
      }

      if (frameFiles.length === 0) {
        throw new Error('No frames extracted with OpenCV');
      }

      return {
        success: true,
        frames: frameFiles,
        method: 'opencv',
      };
    } catch (error) {
      throw new Error(`OpenCV extraction failed: ${error}`);
    }
  }

  private async extractWithVideoThumbnail(
    inputPath: string,
    outputDir: string,
    fps: number
  ): Promise<FrameExtractionResult> {
    try {
      const videoThumbnail = require('video-thumbnail');
      const frameFiles: string[] = [];

      // Get video duration first (estimate based on typical MRI video length)
      const durationEstimate = 20; // seconds, fallback
      const frameCount = Math.floor(durationEstimate * fps);

      for (let i = 0; i < frameCount; i++) {
        const timestamp = (i / fps).toFixed(2);
        const outputPath = path.join(outputDir, `frame_${String(i + 1).padStart(3, '0')}.png`);

        try {
          await videoThumbnail({
            uri: inputPath,
            timestamp: timestamp,
            output: outputPath,
            width: 512,
            height: 512,
          });
          frameFiles.push(outputPath);
        } catch (frameError) {
          // If we can't extract this frame, we might be past the video end
          console.warn(`Failed to extract frame at ${timestamp}s:`, frameError);
          break;
        }
      }

      if (frameFiles.length === 0) {
        throw new Error('No frames extracted');
      }

      return {
        success: true,
        frames: frameFiles,
        method: 'video-thumbnail',
      };
    } catch (error) {
      throw new Error(`video-thumbnail extraction failed: ${error}`);
    }
  }

  private async extractWithFFmpegExtract(
    inputPath: string,
    outputDir: string,
    fps: number
  ): Promise<FrameExtractionResult> {
    try {
      const extractFrames = require('ffmpeg-extract-frames');
      const frameFiles: string[] = [];

      // Extract frames at specified FPS
      const durationEstimate = 20; // seconds
      const frameCount = Math.floor(durationEstimate * fps);

      for (let i = 0; i < frameCount; i++) {
        const timestamp = i / fps;
        const outputPath = path.join(outputDir, `frame_${String(i + 1).padStart(3, '0')}.png`);

        try {
          await extractFrames({
            input: inputPath,
            output: outputPath,
            offsets: [timestamp * 1000], // milliseconds
          });
          frameFiles.push(outputPath);
        } catch (frameError) {
          // If we can't extract this frame, we might be past the video end
          console.warn(`Failed to extract frame at ${timestamp}s:`, frameError);
          break;
        }
      }

      if (frameFiles.length === 0) {
        throw new Error('No frames extracted');
      }

      return {
        success: true,
        frames: frameFiles,
        method: 'ffmpeg-extract-frames',
      };
    } catch (error) {
      throw new Error(`ffmpeg-extract-frames extraction failed: ${error}`);
    }
  }


  async cleanup(): Promise<void> {
    // Simple cleanup - no external resources to clean up
    return Promise.resolve();
  }
}

export default VideoProcessor;