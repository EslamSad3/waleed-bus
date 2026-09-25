import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { ConfigService } from '../config/config.module.js';
import { CodedException } from '../common/filters/coded.exception.js';

const BUS_IMAGES_BUCKET = 'bus-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type DetectedImage = { ext: 'jpg' | 'png' | 'webp'; mime: string };

function detectImage(buffer: Buffer): DetectedImage | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

/**
 * Bus image uploads (spec 007 follow-up). Files land in the public
 * `bus-images` Supabase Storage bucket (provisioned via
 * `supabase db push`); the database keeps only the public URL.
 * Writes use the service_role key — bucket policies grant public reads
 * and no direct user writes.
 */
@Injectable()
export class UploadsService {
  constructor(private readonly config: ConfigService) {}

  async uploadBusImage(
    fleetId: string,
    file: { buffer?: Buffer; size?: number } | undefined,
  ): Promise<{ url: string }> {
    const buffer = file?.buffer;
    if (!buffer || buffer.length === 0) {
      throw new CodedException(400, 'VALIDATION_FAILED', 'Image file is required.');
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new CodedException(
        400,
        'IMAGE_TOO_LARGE',
        'Image must be 5 MB or smaller.',
      );
    }
    const detected = detectImage(buffer);
    if (!detected) {
      throw new CodedException(
        400,
        'INVALID_IMAGE_TYPE',
        'Image must be JPEG, PNG, or WebP.',
      );
    }
    const { supabaseUrl, supabaseServiceRoleKey } = this.config.config.storage;
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new CodedException(
        503,
        'STORAGE_NOT_CONFIGURED',
        'Image uploads are not configured.',
      );
    }
    let compressed: Buffer;
    try {
      const pipeline = sharp(buffer)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
      compressed =
        detected.ext === 'png'
          ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
          : detected.ext === 'webp'
            ? await pipeline.webp({ quality: 80 }).toBuffer()
            : await pipeline.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    } catch {
      throw new CodedException(
        400,
        'INVALID_IMAGE_TYPE',
        'Image file is corrupted or unsupported.',
      );
    }
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const path = `${fleetId}/${randomUUID()}.${detected.ext}`;
    const { error } = await supabase.storage
      .from(BUS_IMAGES_BUCKET)
      .upload(path, compressed, { contentType: detected.mime, upsert: false });
    if (error) {
      throw new CodedException(
        502,
        'STORAGE_UPLOAD_FAILED',
        'Image upload failed, try again.',
      );
    }
    const { data } = supabase.storage
      .from(BUS_IMAGES_BUCKET)
      .getPublicUrl(path);
    return { url: data.publicUrl };
  }
}
