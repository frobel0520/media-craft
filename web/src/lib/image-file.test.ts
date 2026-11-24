import { describe, expect, it } from 'vitest';
import { computeCropRect, formatOutputFileName, isAcceptedImageFile } from './image-file';

describe('image workbench file selection', () => {
  it('accepts image MIME types reported by the browser', () => {
    expect(isAcceptedImageFile({ name: 'example', type: 'image/png' })).toBe(true);
  });

  it('retains the known-suffix fallback when MIME is absent', () => {
    expect(isAcceptedImageFile({ name: 'sample.AVIF', type: '' })).toBe(true);
    expect(isAcceptedImageFile({ name: 'sample.ICO', type: 'application/octet-stream' })).toBe(true);
  });

  it('rejects unknown files with a non-image MIME type', () => {
    expect(isAcceptedImageFile({ name: 'sample.png.txt', type: 'text/plain' })).toBe(false);
    expect(isAcceptedImageFile({ name: 'clip.mp4', type: 'video/mp4' })).toBe(false);
  });
});

describe('computeCropRect', () => {
  it('returns full dimensions for original ratio', () => {
    expect(computeCropRect(1600, 900, 'original')).toEqual({ sx: 0, sy: 0, sw: 1600, sh: 900 });
  });

  it('crops horizontally centered for 1:1 from landscape image', () => {
    expect(computeCropRect(1600, 900, '1:1')).toEqual({ sx: 350, sy: 0, sw: 900, sh: 900 });
  });

  it('crops vertically centered for 16:9 from square image', () => {
    expect(computeCropRect(1600, 1600, '16:9')).toEqual({ sx: 0, sy: 350, sw: 1600, sh: 900 });
  });
});

describe('formatOutputFileName', () => {
  it('preserves literal template and replacement syntax from the original file name', () => {
    expect(
      formatOutputFileName('summer{index}$&$$.jpg', 'webp', '{name}-{index}', {
        width: 1280,
        height: 720,
        index: 3,
      }),
    ).toBe('summer{index}$&$$-03.webp');
  });

  it('expands template placeholders and pads index', () => {
    expect(
      formatOutputFileName('holiday.jpg', 'webp', '{name}_{width}x{height}_{index}', {
        width: 1280,
        height: 720,
        index: 3,
      }),
    ).toBe('holiday_1280x720_03.webp');
  });

  it('sanitizes path traversal and unsafe filename characters', () => {
    expect(
      formatOutputFileName('photo.png', 'jpg', '../{name}:v1', {
        width: 800,
        height: 600,
      }),
    ).toBe('-photo-v1.jpg');
  });
});
