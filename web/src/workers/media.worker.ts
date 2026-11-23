import { MediaWasmEngine } from '../lib/wasm-client';
import { renderFaviconBundle } from '../lib/favicon-bundle';
import type { OutputFormat, ProcessOptions, WorkerRequest, WorkerResponse } from '../types';

let enginePromise: Promise<MediaWasmEngine> | null = null;

function extForMime(mime: OutputFormat): string {
  switch (mime) {
    case 'image/webp':
      return 'webp';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/avif':
      return 'avif';
    case 'image/bmp':
      return 'bmp';
    case 'image/x-icon':
      return 'ico';
  }
}

function buildOutputFileName(originalName: string, ext: string, suffix: string): string {
  const base = originalName.replace(/\.[^/.]+$/, '');
  return `${base}${suffix}.${ext}`;
}

async function compressAndConvert(
  engine: MediaWasmEngine,
  inputBytes: Uint8Array,
  inputMime: string,
  options: ProcessOptions,
): Promise<{ bytes: Uint8Array; width: number; height: number; mimeType: OutputFormat }> {
  const inputBlob = new Blob([inputBytes.slice().buffer], { type: inputMime || 'application/octet-stream' });
  const bitmap = await createImageBitmap(inputBlob);
  try {
    let targetWidth = bitmap.width;
    let targetHeight = bitmap.height;

    if (options.maxWidth > 0 && targetWidth > options.maxWidth) {
      const scale = options.maxWidth / targetWidth;
      targetWidth = Math.max(1, Math.round(targetWidth * scale));
      targetHeight = Math.max(1, Math.round(targetHeight * scale));
    }

    // Standard ICO container supports up to 256x256.
    if (options.outputFormat === 'image/x-icon' && (targetWidth > 256 || targetHeight > 256)) {
      const scale = Math.min(256 / targetWidth, 256 / targetHeight);
      targetWidth = Math.max(1, Math.round(targetWidth * scale));
      targetHeight = Math.max(1, Math.round(targetHeight * scale));
    }

    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('瀏覽器不支援 OffscreenCanvas 2D 繪圖環境');
    }

    // Fill white background when converting transparent images to JPEG or BMP.
    if (options.outputFormat === 'image/jpeg' || options.outputFormat === 'image/bmp') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    if (options.outputFormat === 'image/bmp') {
      const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const bmpBytes = engine.encodeBmp(
        new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength),
        targetWidth,
        targetHeight,
      );
      return { bytes: bmpBytes, width: targetWidth, height: targetHeight, mimeType: 'image/bmp' };
    }

    if (options.outputFormat === 'image/x-icon') {
      const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
      const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
      const icoBytes = engine.encodeIco(pngBytes, targetWidth, targetHeight);
      return { bytes: icoBytes, width: targetWidth, height: targetHeight, mimeType: 'image/x-icon' };
    }

    const quality = Math.min(1, Math.max(0.1, options.quality / 100));
    const blob = await canvas.convertToBlob({
      type: options.outputFormat,
      quality: options.outputFormat === 'image/png' ? undefined : quality,
    });
    if (options.outputFormat === 'image/avif' && blob.type !== 'image/avif') {
      throw new Error('目前瀏覽器不支援本地 AVIF 編碼，請改選 WebP 或 PNG');
    }
    const outBytes = new Uint8Array(await blob.arrayBuffer());
    return {
      bytes: outBytes,
      width: targetWidth,
      height: targetHeight,
      mimeType: options.outputFormat,
    };
  } finally {
    bitmap.close();
  }
}

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  try {
    if (req.type === 'init') {
      enginePromise = MediaWasmEngine.load(req.wasmUrl);
      await enginePromise;
      post({ type: 'ready' });
      return;
    }

    if (!enginePromise) {
      throw new Error('WASM 核心尚未初始化');
    }
    const engine = await enginePromise;

    if (req.type === 'inspect') {
      const bytes = new Uint8Array(req.buffer);
      const report = engine.inspectImage(bytes);
      post({ type: 'inspected', id: req.id, report });
      return;
    }

    if (req.type === 'process') {
      const start = performance.now();
      const inputBytes = new Uint8Array(req.buffer);
      const beforeReport = engine.inspectImage(inputBytes);

      if (req.options.mode === 'lossless-strip') {
        const cleaned = engine.stripMetadata(inputBytes);
        const afterReport = engine.inspectImage(cleaned);
        const ext = beforeReport.format === 'jpeg' ? 'jpg' : beforeReport.format;
        const fileName = buildOutputFileName(req.fileName, ext, '-clean');
        const durationMs = Math.max(1, Math.round(performance.now() - start));
        const outBuffer = cleaned.slice().buffer;
        post(
          {
            type: 'processed',
            id: req.id,
            buffer: outBuffer,
            mimeType: beforeReport.mimeType,
            fileName,
            width: afterReport.width ?? beforeReport.width ?? 0,
            height: afterReport.height ?? beforeReport.height ?? 0,
            beforeReport,
            afterReport,
            durationMs,
          },
          [outBuffer],
        );
        return;
      }

      const converted = await compressAndConvert(engine, inputBytes, beforeReport.mimeType, req.options);
      // Verify output has 0 EXIF/metadata via Rust WASM; strip if browser added any ancillary chunk.
      let finalBytes = converted.bytes;
      let afterReport = engine.inspectImage(finalBytes);
      if (afterReport.hasPrivacyRisk) {
        finalBytes = engine.stripMetadata(finalBytes);
        afterReport = engine.inspectImage(finalBytes);
      }

      const ext = extForMime(converted.mimeType);
      const fileName = buildOutputFileName(req.fileName, ext, '-craft');
      const durationMs = Math.max(1, Math.round(performance.now() - start));
      const outBuffer = finalBytes.slice().buffer;

      post(
        {
          type: 'processed',
          id: req.id,
          buffer: outBuffer,
          mimeType: converted.mimeType,
          fileName,
          width: converted.width,
          height: converted.height,
          beforeReport,
          afterReport,
          durationMs,
        },
        [outBuffer],
      );
      return;
    }

    if (req.type === 'favicon-bundle') {
      const bundle = await renderFaviconBundle(engine, req.buffer);
      post({ type: 'favicon-generated', id: req.id, bundle }, [bundle.zip, ...bundle.files.map((file) => file.buffer)]);
      return;
    }

    if (req.type === 'zip') {
      const entries = req.files.map((f) => ({
        name: f.name,
        bytes: new Uint8Array(f.buffer),
      }));
      const zipBytes = engine.buildZip(entries);
      const zipBuffer = zipBytes.slice().buffer;
      post({ type: 'zipped', id: req.id, buffer: zipBuffer }, [zipBuffer]);
      return;
    }

    if (req.type === 'encode-wav') {
      const pcm = new Uint8Array(req.pcmBuffer);
      const wavBytes = engine.encodeWav(pcm, req.sampleRate, req.channels);
      const wavBuffer = wavBytes.slice().buffer;
      post({ type: 'wav-encoded', id: req.id, buffer: wavBuffer }, [wavBuffer]);
      return;
    }

    if (req.type === 'svg-clean') {
      const { svg, report } = engine.cleanSvg(new Uint8Array(req.buffer), req.collapseWhitespace);
      const svgBuffer = svg.slice().buffer;
      post({ type: 'svg-cleaned', id: req.id, buffer: svgBuffer, report }, [svgBuffer]);
    }
  } catch (err) {
    const id = 'id' in req ? req.id : 'init';
    const message = err instanceof Error ? err.message : '處理圖片時發生未知錯誤';
    post({ type: 'error', id, message });
  }
};
