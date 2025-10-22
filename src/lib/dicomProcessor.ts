import * as dicomParser from 'dicom-parser';

export interface DicomMetadata {
  patientName?: string;
  patientID?: string;
  studyDate?: string;
  modality?: string;
  seriesDescription?: string;
  instanceNumber?: number;
  [key: string]: any;
}

export interface ProcessedDicom {
  imageDataUrl: string;
  metadata: DicomMetadata;
  fileName: string;
}

export class DicomProcessor {
  /**
   * Process multiple DICOM files
   * @param files - Array of DICOM files
   * @returns Promise of processed DICOM data
   */
  async processFiles(files: File[]): Promise<ProcessedDicom[]> {
    const results: ProcessedDicom[] = [];

    for (const file of files) {
      try {
        const processed = await this.processSingleFile(file);
        results.push(processed);
      } catch (error) {
        console.error(`Error processing ${file.name}:`, error);
        // Continue processing other files even if one fails
      }
    }

    // Sort by instance number if available
    results.sort((a, b) => {
      const aInstance = a.metadata.instanceNumber || 0;
      const bInstance = b.metadata.instanceNumber || 0;
      return aInstance - bInstance;
    });

    return results;
  }

  /**
   * Process a single DICOM file
   * @param file - DICOM file
   * @returns Promise of processed DICOM data
   */
  async processSingleFile(file: File): Promise<ProcessedDicom> {
    const arrayBuffer = await file.arrayBuffer();
    const byteArray = new Uint8Array(arrayBuffer);

    // Parse DICOM file using dicom-parser
    const dataSet = dicomParser.parseDicom(byteArray);

    // Helper function to safely get string
    const getString = (tag: string): string | undefined => {
      try {
        return dataSet.string(tag);
      } catch {
        return undefined;
      }
    };

    // Helper function to safely get number
    const getNumber = (tag: string): number | undefined => {
      try {
        const value = dataSet.intString(tag);
        return value ? parseInt(value) : undefined;
      } catch {
        return undefined;
      }
    };

    // Extract metadata using standard DICOM tags
    const metadata: DicomMetadata = {
      patientName: getString('x00100010'),
      patientID: getString('x00100020'),
      studyDate: getString('x00080020'),
      modality: getString('x00080060'),
      seriesDescription: getString('x0008103e'),
      instanceNumber: getNumber('x00200013'),
    };

    console.log('Parsed DICOM metadata:', metadata);

    // Convert DICOM pixel data to image
    const imageDataUrl = await this.convertToImage(dataSet);

    return {
      imageDataUrl,
      metadata,
      fileName: file.name,
    };
  }

  /**
   * Convert DICOM pixel data to base64 image
   * @param dataSet - DICOM dataset from dicom-parser
   * @returns Promise of base64 image data URL
   */
  private async convertToImage(dataSet: dicomParser.DataSet): Promise<string> {
    try {
      // Helper to safely get uint16 value
      const getUint16 = (tag: string): number | undefined => {
        try {
          return dataSet.uint16(tag);
        } catch {
          return undefined;
        }
      };

      // Helper to safely get string value
      const getString = (tag: string): string | undefined => {
        try {
          return dataSet.string(tag);
        } catch {
          return undefined;
        }
      };

      // Get image properties using standard DICOM tags
      const rows = getUint16('x00280010');
      const columns = getUint16('x00280011');
      const samplesPerPixel = getUint16('x00280002') || 1;
      const bitsAllocated = getUint16('x00280100') || 8;
      const bitsStored = getUint16('x00280101') || bitsAllocated;
      const pixelRepresentation = getUint16('x00280103') || 0; // 0=unsigned, 1=signed
      const photometricInterpretation = getString('x00280004');

      console.log('DICOM Image Info:', {
        rows,
        columns,
        samplesPerPixel,
        bitsAllocated,
        bitsStored,
        pixelRepresentation,
        photometricInterpretation
      });

      if (!rows || !columns) {
        throw new Error('Missing required DICOM image dimensions');
      }

      // Get pixel data
      const pixelDataElement = dataSet.elements.x7fe00010;
      if (!pixelDataElement) {
        throw new Error('No pixel data found in DICOM file');
      }

      const pixelData = new Uint8Array(
        dataSet.byteArray.buffer,
        pixelDataElement.dataOffset,
        pixelDataElement.length
      );

      console.log('Pixel data length:', pixelData.length, 'Expected:', rows * columns * samplesPerPixel);

      // Create canvas
      const canvas = document.createElement('canvas');
      canvas.width = columns;
      canvas.height = rows;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // Create ImageData
      const imageData = ctx.createImageData(columns, rows);
      const data = imageData.data;

      if (samplesPerPixel === 1) {
        // Grayscale image
        let pixelArray: number[];

        if (bitsAllocated === 16) {
          // 16-bit grayscale
          const pixelData16 = new Uint16Array(
            dataSet.byteArray.buffer,
            pixelDataElement.dataOffset,
            pixelDataElement.length / 2
          );
          pixelArray = Array.from(pixelData16);
        } else {
          // 8-bit grayscale
          pixelArray = Array.from(pixelData);
        }

        // Find min/max for auto-windowing
        let min = Infinity;
        let max = -Infinity;
        for (const value of pixelArray) {
          if (value < min) min = value;
          if (value > max) max = value;
        }

        console.log('Pixel value range:', { min, max });

        // Calculate window/level
        const windowCenter = (max + min) / 2;
        const windowWidth = max - min;

        console.log('Using window/level:', { windowCenter, windowWidth });

        // Apply windowing
        for (let i = 0; i < pixelArray.length; i++) {
          const pixelValue = pixelArray[i];
          const lower = windowCenter - (windowWidth / 2);
          const upper = windowCenter + (windowWidth / 2);

          let normalized;
          if (pixelValue <= lower) {
            normalized = 0;
          } else if (pixelValue >= upper) {
            normalized = 255;
          } else {
            normalized = ((pixelValue - lower) / windowWidth) * 255;
          }

          // Handle MONOCHROME1 (inverted)
          if (photometricInterpretation === 'MONOCHROME1') {
            normalized = 255 - normalized;
          }

          const idx = i * 4;
          data[idx] = normalized;     // R
          data[idx + 1] = normalized; // G
          data[idx + 2] = normalized; // B
          data[idx + 3] = 255;        // A
        }
      } else {
        // RGB image
        for (let i = 0; i < pixelData.length; i += samplesPerPixel) {
          const idx = (i / samplesPerPixel) * 4;
          data[idx] = pixelData[i];         // R
          data[idx + 1] = pixelData[i + 1]; // G
          data[idx + 2] = pixelData[i + 2]; // B
          data[idx + 3] = 255;              // A
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // Convert canvas to base64
      return canvas.toDataURL('image/png');
    } catch (error) {
      console.error('Error converting DICOM to image:', error);
      // Return a placeholder image if conversion fails
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    }
  }

  /**
   * Validate if a file is a valid DICOM file
   * @param file - File to validate
   * @returns Promise<boolean>
   */
  async validateDicomFile(file: File): Promise<boolean> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const byteArray = new Uint8Array(arrayBuffer);
      dicomParser.parseDicom(byteArray);
      return true;
    } catch (error) {
      return false;
    }
  }
}
