import type { CropRatio } from '../types';

export function isAcceptedImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|gif|bmp|svg|ico)$/i.test(file.name);
}

const CROP_RATIOS: Record<Exclude<CropRatio, 'original'>, number> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
  '3:2': 3 / 2,
  '9:16': 9 / 16,
};

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Computes a centered crop rectangle for the requested aspect ratio.
 */
export function computeCropRect(srcWidth: number, srcHeight: number, ratio: CropRatio): CropRect {
  if (ratio === 'original' || srcWidth <= 0 || srcHeight <= 0) {
    return { sx: 0, sy: 0, sw: srcWidth, sh: srcHeight };
  }
  const targetRatio = CROP_RATIOS[ratio];
  const currentRatio = srcWidth / srcHeight;
  if (Math.abs(currentRatio - targetRatio) < 0.001) {
    return { sx: 0, sy: 0, sw: srcWidth, sh: srcHeight };
  }
  if (currentRatio > targetRatio) {
    const sw = Math.max(1, Math.round(srcHeight * targetRatio));
    const sx = Math.floor((srcWidth - sw) / 2);
    return { sx, sy: 0, sw, sh: srcHeight };
  }
  const sh = Math.max(1, Math.round(srcWidth / targetRatio));
  const sy = Math.floor((srcHeight - sh) / 2);
  return { sx: 0, sy, sw: srcWidth, sh };
}

/**
 * Formats an output file name from a template supporting {name}, {width}, {height}, and {index}.
 */
export function formatOutputFileName(
  originalName: string,
  ext: string,
  template: string,
  meta: { width: number; height: number; index?: number },
): string {
  const base = originalName.replace(/\.[^/.]+$/, '') || 'image';
  const rawTemplate = template.trim() || '{name}-craft';
  const idx = String(meta.index ?? 1).padStart(2, '0');
  const rendered = rawTemplate
    .replaceAll('{name}', base)
    .replaceAll('{width}', String(meta.width))
    .replaceAll('{height}', String(meta.height))
    .replaceAll('{index}', idx);
  const safe = rendered
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\.+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return `${safe || base}.${ext}`;
}
