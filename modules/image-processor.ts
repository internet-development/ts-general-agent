import sharp from 'sharp';
import { logger } from '@modules/logger.js';

//NOTE(self): Bluesky image constraints
const MAX_FILE_SIZE = 976560; // ~953KB to leave buffer under 1MB
const MAX_DIMENSION = 2048;   // Max width/height for Bluesky

export interface ProcessedImage {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  originalSize: number;
  processedSize: number;
}

export interface ProcessImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  maxFileSize?: number;
}

//NOTE(self): Process image for Bluesky upload
//NOTE(self): Strategy: Max resolution, best quality, smallest file size via smart encoding
export async function processImageForUpload(
  inputBuffer: Buffer,
  options: ProcessImageOptions = {}
): Promise<ProcessedImage> {
  const {
    maxWidth = MAX_DIMENSION,
    maxHeight = MAX_DIMENSION,
    maxFileSize = MAX_FILE_SIZE,
  } = options;

  const originalSize = inputBuffer.length;
  logger.info('Processing image', { originalSizeKB: Math.round(originalSize / 1024) });

  //NOTE(self): Get original image metadata
  const metadata = await sharp(inputBuffer).metadata();
  const originalWidth = metadata.width || 0;
  const originalHeight = metadata.height || 0;
  const hasAlpha = metadata.hasAlpha || false;

  logger.debug('Original image', {
    width: originalWidth,
    height: originalHeight,
    format: metadata.format,
    hasAlpha,
  });

  //NOTE(self): Calculate target dimensions - max resolution within limits
  let targetWidth = originalWidth;
  let targetHeight = originalHeight;

  if (originalWidth > maxWidth || originalHeight > maxHeight) {
    const widthRatio = maxWidth / originalWidth;
    const heightRatio = maxHeight / originalHeight;
    const ratio = Math.min(widthRatio, heightRatio);

    targetWidth = Math.round(originalWidth * ratio);
    targetHeight = Math.round(originalHeight * ratio);

    logger.info('Resizing to max allowed', { targetWidth, targetHeight });
  }

  //NOTE(self): Use JPEG for photos, PNG for images with transparency
  const formats: Array<{
    name: string;
    mimeType: string;
    encode: (pipeline: sharp.Sharp) => sharp.Sharp;
  }> = hasAlpha
    ? [
        {
          //NOTE(self): PNG for images with transparency
          name: 'png',
          mimeType: 'image/png',
          encode: (p) => p.png({
            compressionLevel: 9,
            effort: 10,
            palette: false, // Keep full color
          }),
        },
      ]
    : [
        {
          //NOTE(self): JPEG for everything else - best compression for photos
          name: 'jpeg',
          mimeType: 'image/jpeg',
          encode: (p) => p.jpeg({
            quality: 95,       // High quality
            mozjpeg: true,     // Better compression algorithm
            chromaSubsampling: '4:4:4', // No chroma subsampling for quality
          }),
        },
      ];

  //NOTE(self): Try each format, pick smallest that fits
  let bestResult: { buffer: Buffer; mimeType: string; name: string } | null = null;

  for (const format of formats) {
    try {
      const pipeline = sharp(inputBuffer)
        .resize(targetWidth, targetHeight, {
          fit: 'inside',
          withoutEnlargement: true,
          kernel: 'lanczos3', // Best quality resampling
        });

      const buffer = await format.encode(pipeline).toBuffer();

      logger.debug('Format attempt', {
        format: format.name,
        sizeKB: Math.round(buffer.length / 1024),
        fits: buffer.length <= maxFileSize,
      });

      if (buffer.length <= maxFileSize) {
        if (!bestResult || buffer.length < bestResult.buffer.length) {
          bestResult = {
            buffer,
            mimeType: format.mimeType,
            name: format.name,
          };
        }
      }
    } catch (err) {
      logger.debug('Format not supported', { format: format.name, error: String(err) });
    }
  }

  //NOTE(self): If no format fits, progressively reduce dimensions (not quality)
  if (!bestResult) {
    logger.warn('Image too large at full resolution, reducing dimensions');

    let scale = 0.9;
    while (scale >= 0.3) {
      const scaledWidth = Math.round(targetWidth * scale);
      const scaledHeight = Math.round(targetHeight * scale);

      const pipeline = sharp(inputBuffer)
        .resize(scaledWidth, scaledHeight, {
          fit: 'inside',
          withoutEnlargement: true,
          kernel: 'lanczos3',
        });

      //NOTE(self): Use PNG for transparency, JPEG otherwise
      const buffer = hasAlpha
        ? await pipeline.png({ compressionLevel: 9, effort: 10 }).toBuffer()
        : await pipeline.jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();

      logger.debug('Dimension reduction attempt', {
        scale,
        dimensions: `${scaledWidth}x${scaledHeight}`,
        sizeKB: Math.round(buffer.length / 1024),
      });

      if (buffer.length <= maxFileSize) {
        bestResult = {
          buffer,
          mimeType: hasAlpha ? 'image/png' : 'image/jpeg',
          name: hasAlpha ? 'png' : 'jpeg',
        };
        targetWidth = scaledWidth;
        targetHeight = scaledHeight;
        break;
      }

      scale -= 0.1;
    }
  }

  if (!bestResult) {
    throw new Error('Could not compress image to fit size limit while maintaining quality');
  }

  //NOTE(self): Get final dimensions
  const finalMeta = await sharp(bestResult.buffer).metadata();
  const finalWidth = finalMeta.width || targetWidth;
  const finalHeight = finalMeta.height || targetHeight;

  logger.info('Image processed', {
    format: bestResult.name,
    originalSizeKB: Math.round(originalSize / 1024),
    processedSizeKB: Math.round(bestResult.buffer.length / 1024),
    compressionRatio: `${Math.round((1 - bestResult.buffer.length / originalSize) * 100)}%`,
    dimensions: `${finalWidth}x${finalHeight}`,
  });

  return {
    buffer: bestResult.buffer,
    mimeType: bestResult.mimeType,
    width: finalWidth,
    height: finalHeight,
    originalSize,
    processedSize: bestResult.buffer.length,
  };
}

//NOTE(self): Process image from base64 string
export async function processBase64ImageForUpload(
  base64Data: string,
  options: ProcessImageOptions = {}
): Promise<ProcessedImage> {
  const inputBuffer = Buffer.from(base64Data, 'base64');
  return processImageForUpload(inputBuffer, options);
}

//NOTE(self): Get image dimensions from buffer
export async function getImageDimensions(
  buffer: Buffer
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(buffer).metadata();
  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
  };
}
