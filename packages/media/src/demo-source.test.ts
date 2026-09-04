import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildDemoPhotoSource } from './demo-source';

describe('buildDemoPhotoSource', () => {
  it('genera un PNG monocromo con dimensiones de producto', async () => {
    const source = await buildDemoPhotoSource({ listingSlug: 'iphone-15-128-negro', photoIndex: 0 });
    const metadata = await sharp(source).metadata();

    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(900);
  });

  it('es estable para el mismo listing y cambia entre fotos', async () => {
    const options = { listingSlug: 'iphone-15-128-negro', photoIndex: 1 } as const;
    const first = await buildDemoPhotoSource(options);
    const second = await buildDemoPhotoSource(options);
    const otherPhoto = await buildDemoPhotoSource({ ...options, photoIndex: 2 });

    expect(first.equals(second)).toBe(true);
    expect(first.equals(otherPhoto)).toBe(false);
  });
});
