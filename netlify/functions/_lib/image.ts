import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { ApiError } from './http';

export const uploadPayloadSchema = z.object({
  filename: z.string().min(1).max(180),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  data: z.string().min(1),
});

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 6000;

function sniffImage(buffer: Buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export async function validateAndReencodeImage(payload: z.infer<typeof uploadPayloadSchema>) {
  if (/[\\/]|\\.\\./.test(payload.filename) || /\.svg$/i.test(payload.filename)) {
    throw new ApiError(400, 'unsafe_filename', 'Filename is not allowed.');
  }

  const input = Buffer.from(payload.data, 'base64');
  if (input.byteLength > MAX_INPUT_BYTES) {
    throw new ApiError(413, 'image_too_large', 'Image input is too large.');
  }

  const detected = sniffImage(input);
  if (!detected || detected !== payload.mimeType) {
    throw new ApiError(400, 'invalid_image_type', 'Image MIME type did not match file contents.');
  }

  const image = sharp(input, { failOn: 'error' }).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
    throw new ApiError(400, 'invalid_image_size', 'Image dimensions are missing or too large.');
  }

  let ext: 'jpg' | 'png' | 'webp';
  let output: Buffer;
  if (payload.mimeType === 'image/png') {
    ext = 'png';
    output = await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  } else if (payload.mimeType === 'image/webp') {
    ext = 'webp';
    output = await image.webp({ quality: 86 }).toBuffer();
  } else {
    ext = 'jpg';
    output = await image.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  }

  if (output.byteLength > MAX_OUTPUT_BYTES) {
    ext = 'webp';
    output = await sharp(input, { failOn: 'error' }).rotate().webp({ quality: 78 }).toBuffer();
  }
  if (output.byteLength > MAX_OUTPUT_BYTES) {
    throw new ApiError(413, 'encoded_image_too_large', 'Re-encoded image is still larger than 2 MB.');
  }

  const hash = createHash('sha256').update(output).digest('hex');
  return {
    bytes: output,
    ext,
    hash,
    path: `app/public/uploads/${hash}.${ext}`,
    src: `./uploads/${hash}.${ext}`,
  };
}
