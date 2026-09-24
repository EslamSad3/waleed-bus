import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { UploadsService } from './uploads.service.js';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

// Fixtures are magic-byte headers only (not decodable images), so sharp is
// stubbed to a pass-through pipeline; corruption handling is covered by the
// magic-byte pre-check tests.
vi.mock('sharp', () => ({
  default: vi.fn(() => {
    const pipeline = {
      rotate: vi.fn(() => pipeline),
      resize: vi.fn(() => pipeline),
      png: vi.fn(() => pipeline),
      webp: vi.fn(() => pipeline),
      jpeg: vi.fn(() => pipeline),
      toBuffer: vi.fn(async () => Buffer.from('compressed-image-bytes')),
    };
    return pipeline;
  }),
}));

function serviceWith(storage: Record<string, string | undefined>) {
  const config = { config: { storage } };
  return new UploadsService(config as never);
}

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const TEXT = Buffer.from('hello world, not an image at all..............');

describe('UploadsService (spec 007 follow-up)', () => {
  it('rejects missing files with 400', async () => {
    const service = serviceWith({
      supabaseUrl: 'https://x.supabase.co',
      supabaseServiceRoleKey: 'key',
    });
    const err = await service
      .uploadBusImage('fleet-1', undefined)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getStatus()).toBe(400);
  });

  it('rejects non-image content with INVALID_IMAGE_TYPE', async () => {
    const service = serviceWith({
      supabaseUrl: 'https://x.supabase.co',
      supabaseServiceRoleKey: 'key',
    });
    const err = await service
      .uploadBusImage('fleet-1', {
        buffer: TEXT,
        mimetype: 'image/png',
      } as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'INVALID_IMAGE_TYPE',
    });
  });

  it('returns 503 when storage is not configured', async () => {
    const service = serviceWith({});
    const err = await service
      .uploadBusImage('fleet-1', { buffer: PNG } as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    });
  });

  it.each([
    ['png', PNG],
    ['jpg', JPEG],
    ['webp', WEBP],
  ])('uploads %s and returns the public URL', async (ext, buffer) => {
    const upload = vi.fn(async () => ({ data: { path: `fleet-1/x.${ext}` }, error: null }));
    const getPublicUrl = vi.fn(() => ({
      data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/bus-images/fleet-1/x.${ext}` },
    }));
    const { createClient } = await import('@supabase/supabase-js');
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue({
      storage: { from: () => ({ upload, getPublicUrl }) },
    });
    const service = serviceWith({
      supabaseUrl: 'https://x.supabase.co',
      supabaseServiceRoleKey: 'key',
    });
    const result = await service.uploadBusImage('fleet-1', { buffer } as never);
    expect(upload).toHaveBeenCalledOnce();
    const calls = upload.mock.calls as unknown[][];
    expect(calls).toHaveLength(1);
    const uploadedPath = calls[0][0] as string;
    expect(uploadedPath).toContain(`fleet-1/`);
    expect(uploadedPath.endsWith(`.${ext}`)).toBe(true);
    expect(result.url).toContain('bus-images');
  });
});
