import type { MediaWasmEngine } from './wasm-client';
import type { FaviconBundle } from '../types';

const SIZES = [
  { size: 32, name: 'favicon.ico', type: 'image/x-icon' },
  { size: 192, name: 'icon-192.png', type: 'image/png' },
  { size: 512, name: 'icon-512.png', type: 'image/png' },
] as const;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 36_000_000;

export async function renderFaviconBundle(
  engine: MediaWasmEngine,
  buffer: ArrayBuffer,
): Promise<FaviconBundle> {
  if (!buffer.byteLength || buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error('請選擇 32 MiB 以內的圖片');
  }
  const info = engine.inspectImage(new Uint8Array(buffer));
  if (info.format === 'unknown' || info.format === 'svg') {
    throw new Error('請選擇瀏覽器可解碼的點陣圖片');
  }
  if (info.width && info.height && info.width * info.height > MAX_IMAGE_PIXELS) {
    throw new Error('圖片尺寸超過 3600 萬像素上限');
  }

  const bitmap = await createImageBitmap(new Blob([buffer], { type: info.mimeType }));
  try {
    if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
      throw new Error('圖片尺寸超過 3600 萬像素上限');
    }
    const files: FaviconBundle['files'] = [];
    for (const icon of SIZES) {
      const canvas = new OffscreenCanvas(icon.size, icon.size);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('瀏覽器無法在背景繪製圖示');
      const scale = icon.size / Math.max(bitmap.width, bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, Math.floor((icon.size - width) / 2), Math.floor((icon.size - height) / 2), width, height);
      const png = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
      const output = icon.type === 'image/x-icon'
        ? engine.encodeIco(new Uint8Array(png), icon.size, icon.size).slice().buffer
        : png;
      files.push({ name: icon.name, size: icon.size, type: icon.type, buffer: output });
    }
    const zip = engine.buildZip(files.map(({ name, buffer }) => ({ name, bytes: new Uint8Array(buffer) })));
    return { files, zip: zip.slice().buffer };
  } finally {
    bitmap.close();
  }
}
