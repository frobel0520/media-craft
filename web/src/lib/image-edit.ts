/**
 * Pure geometry for the image workbench edits (crop → rotate → flip → resize).
 * No DOM / canvas access here so the maths can be checked in isolation.
 */

export type Rotation = 0 | 90 | 180 | 270;

/** Center-crop aspect ratio of the *final* output (after rotation). */
export type CropAspect = 'original' | '1:1' | '4:3' | '3:2' | '16:9' | '3:4' | '9:16';

export interface ImageEdit {
  crop: CropAspect;
  rotation: Rotation;
  flipH: boolean;
  flipV: boolean;
}

export const NO_EDIT: ImageEdit = { crop: 'original', rotation: 0, flipH: false, flipV: false };

export interface EditLimits {
  /** 0 = no limit. Applied to the output width, never upscales. */
  maxWidth: number;
  /** 0 = no limit. Applied to both output sides (ICO container cap). */
  maxSide: number;
}

export interface DrawPlan {
  /** Source rectangle in the original bitmap. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Size of the drawn source region before rotation. */
  drawWidth: number;
  drawHeight: number;
  /** Final canvas size (after rotation). */
  outWidth: number;
  outHeight: number;
  rotation: Rotation;
  flipH: boolean;
  flipV: boolean;
}

const ASPECTS: Record<Exclude<CropAspect, 'original'>, [number, number]> = {
  '1:1': [1, 1],
  '4:3': [4, 3],
  '3:2': [3, 2],
  '16:9': [16, 9],
  '3:4': [3, 4],
  '9:16': [9, 16],
};

export function isQuarterTurn(rotation: Rotation): boolean {
  return rotation === 90 || rotation === 270;
}

export function rotateBy(current: Rotation, delta: 90 | -90): Rotation {
  return ((((current + delta) % 360) + 360) % 360) as Rotation;
}

export function hasEdits(edit: ImageEdit): boolean {
  return edit.crop !== 'original' || edit.rotation !== 0 || edit.flipH || edit.flipV;
}

/**
 * Largest centered rectangle of the requested output aspect inside the source.
 * For quarter turns the aspect is inverted in source space so that the
 * rotated output ends up with the requested ratio.
 */
export function computeCropRect(
  srcWidth: number,
  srcHeight: number,
  crop: CropAspect,
  rotation: Rotation,
): { sx: number; sy: number; sw: number; sh: number } {
  if (srcWidth <= 0 || srcHeight <= 0) {
    throw new Error('圖片尺寸無效，無法裁切');
  }
  if (crop === 'original') {
    return { sx: 0, sy: 0, sw: srcWidth, sh: srcHeight };
  }
  const [aw, ah] = ASPECTS[crop];
  const ratio = isQuarterTurn(rotation) ? ah / aw : aw / ah; // width / height in source space
  let sw = srcWidth;
  let sh = Math.round(srcWidth / ratio);
  if (sh > srcHeight) {
    sh = srcHeight;
    sw = Math.round(srcHeight * ratio);
  }
  sw = Math.max(1, Math.min(srcWidth, sw));
  sh = Math.max(1, Math.min(srcHeight, sh));
  return {
    sx: Math.floor((srcWidth - sw) / 2),
    sy: Math.floor((srcHeight - sh) / 2),
    sw,
    sh,
  };
}

export function planDraw(srcWidth: number, srcHeight: number, edit: ImageEdit, limits: EditLimits): DrawPlan {
  const rect = computeCropRect(srcWidth, srcHeight, edit.crop, edit.rotation);
  const turned = isQuarterTurn(edit.rotation);
  const rotatedW = turned ? rect.sh : rect.sw;
  const rotatedH = turned ? rect.sw : rect.sh;

  let scale = 1;
  if (limits.maxWidth > 0 && rotatedW > limits.maxWidth) {
    scale = limits.maxWidth / rotatedW;
  }
  if (limits.maxSide > 0) {
    const sideScale = Math.min(limits.maxSide / rotatedW, limits.maxSide / rotatedH);
    if (sideScale < scale) scale = sideScale;
  }

  const outWidth = Math.max(1, Math.round(rotatedW * scale));
  const outHeight = Math.max(1, Math.round(rotatedH * scale));
  return {
    ...rect,
    drawWidth: turned ? outHeight : outWidth,
    drawHeight: turned ? outWidth : outHeight,
    outWidth,
    outHeight,
    rotation: edit.rotation,
    flipH: edit.flipH,
    flipV: edit.flipV,
  };
}

/** Minimal subset of CanvasRenderingContext2D used to apply a plan. */
export interface PlanTarget {
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(angle: number): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/**
 * Flips are applied in output space (what the user sees), so the canvas is
 * mirrored first and rotated second.
 */
export function drawWithPlan(ctx: PlanTarget, image: CanvasImageSource, plan: DrawPlan): void {
  ctx.translate(plan.outWidth / 2, plan.outHeight / 2);
  ctx.scale(plan.flipH ? -1 : 1, plan.flipV ? -1 : 1);
  ctx.rotate((plan.rotation * Math.PI) / 180);
  ctx.drawImage(
    image,
    plan.sx,
    plan.sy,
    plan.sw,
    plan.sh,
    -plan.drawWidth / 2,
    -plan.drawHeight / 2,
    plan.drawWidth,
    plan.drawHeight,
  );
}
