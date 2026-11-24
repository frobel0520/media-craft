import { describe, expect, it } from 'vitest';
import { isAcceptedImageFile } from './image-file';

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
