'use client';


interface FrameExtractionOptions {
  fps: number;
  maxFrames?: number;
}

interface ExtractedFrame {
  dataUrl: string;
  timestamp: number;
  frameNumber: number;
}

// MediaInfo.js removed - using duration-based extraction only

export class ClientVideoProcessor {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
    }
  }

  async extractFrames(file: File, options: FrameExtractionOptions): Promise<ExtractedFrame[]> {
    return new Promise((resolve, reject) => {
      if (!this.canvas || !this.ctx) {
        reject(new Error('Canvas not available'));
        return;
      }

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;

      const frames: ExtractedFrame[] = [];
      const { fps, maxFrames = 200 } = options;
      const interval = 1 / fps; // seconds between frames

      let currentTime = 0;
      let frameNumber = 0;

      const extractFrame = () => {
        if (frameNumber >= maxFrames || currentTime >= video.duration) {
          resolve(frames);
          return;
        }

        video.currentTime = currentTime;
      };

      const onSeeked = () => {
        if (!this.canvas || !this.ctx) return;

        // Set canvas size to video dimensions
        this.canvas.width = video.videoWidth || 640;
        this.canvas.height = video.videoHeight || 480;

        // Draw current frame to canvas
        this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);

        // Convert to data URL
        const dataUrl = this.canvas.toDataURL('image/png');

        frames.push({
          dataUrl,
          timestamp: currentTime,
          frameNumber: frameNumber + 1
        });

        frameNumber++;
        currentTime += interval;

        // Extract next frame
        setTimeout(extractFrame, 50); // Small delay to ensure frame is rendered
      };

      const onLoadedMetadata = () => {
        console.log(`Video loaded: ${video.duration}s, ${video.videoWidth}x${video.videoHeight}`);
        extractFrame();
      };

      const onError = (error: any) => {
        reject(new Error(`Video loading failed: ${error.message || 'Unknown error'}`));
      };

      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);

      // Load video file
      const url = URL.createObjectURL(file);
      video.src = url;
      video.load();

      // Cleanup after processing
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 60000); // Clean up after 1 minute
    });
  }

  cleanup(): void {
    if (this.video) {
      this.video.removeEventListener('loadedmetadata', () => {});
      this.video.removeEventListener('seeked', () => {});
      this.video.removeEventListener('error', () => {});
      this.video = null;
    }

    this.canvas = null;
    this.ctx = null;
  }
}