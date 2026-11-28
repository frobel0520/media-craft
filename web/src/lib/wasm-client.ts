import type { InspectReport, SvgCleanReport } from '../types';

interface MediaWasmExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  last_output_ptr(): number;
  last_output_len(): number;
  inspect_image_wasm(ptr: number, len: number): number;
  strip_metadata_wasm(ptr: number, len: number): number;
  zip_begin(): void;
  zip_add_file(namePtr: number, nameLen: number, dataPtr: number, dataLen: number): number;
  zip_finish(): number;
  encode_bmp_wasm(ptr: number, len: number, width: number, height: number): number;
  encode_ico_wasm(ptr: number, len: number, width: number, height: number): number;
  encode_wav_wasm(ptr: number, len: number, sampleRate: number, channels: number): number;
  optimize_gif_wasm(ptr: number, len: number): number;
  clean_svg_wasm(ptr: number, len: number, flags: number): number;
  svg_last_error(): number;
  svg_last_report(): number;
}

const SVG_ERROR_MESSAGES: Record<number, string> = {
  1: 'SVG 檔案超過 20 MiB 上限',
  2: 'SVG 不是有效的 UTF-8 文字檔',
  3: 'SVG 格式錯誤（標籤未正確關閉或屬性重複），無法安全解析',
  4: '這不是 SVG 檔案（最外層必須是 <svg>）',
  5: 'SVG 巢狀層數超過 256 層上限',
};

const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

export class MediaWasmEngine {
  private exports: MediaWasmExports;

  private constructor(exports: MediaWasmExports) {
    this.exports = exports;
  }

  static async load(wasmUrl: string): Promise<MediaWasmEngine> {
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`無法載入 Rust WASM 核心（HTTP ${response.status}）`);
    }
    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new MediaWasmEngine(instance.exports as unknown as MediaWasmExports);
  }

  private writeBytes(data: Uint8Array): { ptr: number; len: number } {
    const len = data.byteLength;
    const ptr = this.exports.alloc(len);
    if (ptr === 0) {
      throw new Error('WASM 記憶體配置失敗（檔案可能超過 100 MiB 上限）');
    }
    new Uint8Array(this.exports.memory.buffer, ptr, len).set(data);
    return { ptr, len };
  }

  private readLastOutput(): Uint8Array {
    const ptr = this.exports.last_output_ptr();
    const len = this.exports.last_output_len();
    if (ptr === 0 || len === 0) {
      return new Uint8Array(0);
    }
    return new Uint8Array(this.exports.memory.buffer, ptr, len).slice();
  }

  inspectImage(bytes: Uint8Array): InspectReport {
    if (bytes.byteLength === 0) {
      throw new Error('圖片檔案為空');
    }
    const { ptr, len } = this.writeBytes(bytes);
    try {
      const outLen = this.exports.inspect_image_wasm(ptr, len);
      if (outLen === 0) {
        throw new Error('Rust WASM 無法解析此圖片標頭');
      }
      const jsonBytes = this.readLastOutput();
      return JSON.parse(textDecoder.decode(jsonBytes)) as InspectReport;
    } finally {
      this.exports.dealloc(ptr, len);
    }
  }

  stripMetadata(bytes: Uint8Array): Uint8Array {
    if (bytes.byteLength === 0) {
      throw new Error('圖片檔案為空');
    }
    const { ptr, len } = this.writeBytes(bytes);
    try {
      const outLen = this.exports.strip_metadata_wasm(ptr, len);
      if (outLen === 0) {
        throw new Error('無損去 EXIF 僅支援標準 JPEG、PNG 或 WebP 檔案');
      }
      return this.readLastOutput();
    } finally {
      this.exports.dealloc(ptr, len);
    }
  }

  buildZip(entries: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
    this.exports.zip_begin();
    for (const entry of entries) {
      const nameBytes = textEncoder.encode(entry.name);
      const nameAlloc = this.writeBytes(nameBytes);
      const dataAlloc = this.writeBytes(entry.bytes);
      try {
        const ok = this.exports.zip_add_file(
          nameAlloc.ptr,
          nameAlloc.len,
          dataAlloc.ptr,
          dataAlloc.len,
        );
        if (ok !== 1) {
          throw new Error(`加入 ZIP 失敗：${entry.name}`);
        }
      } finally {
        this.exports.dealloc(nameAlloc.ptr, nameAlloc.len);
        this.exports.dealloc(dataAlloc.ptr, dataAlloc.len);
      }
    }
    const zipLen = this.exports.zip_finish();
    if (zipLen === 0) {
      throw new Error('ZIP 打包失敗');
    }
    return this.readLastOutput();
  }

  encodeBmp(rgba: Uint8Array, width: number, height: number): Uint8Array {
    const { ptr, len } = this.writeBytes(rgba);
    try {
      const outLen = this.exports.encode_bmp_wasm(ptr, len, width, height);
      if (outLen === 0) {
        throw new Error('Rust WASM 編碼 BMP 失敗');
      }
      return this.readLastOutput();
    } finally {
      this.exports.dealloc(ptr, len);
    }
  }

  encodeIco(pngBytes: Uint8Array, width: number, height: number): Uint8Array {
    const { ptr, len } = this.writeBytes(pngBytes);
    try {
      const outLen = this.exports.encode_ico_wasm(ptr, len, width, height);
      if (outLen === 0) {
        throw new Error('Rust WASM 封裝 ICO 失敗（尺寸須在 256×256 以內）');
      }
      return this.readLastOutput();
    } finally {
      this.exports.dealloc(ptr, len);
    }
  }

  encodeWav(pcmBytes: Uint8Array, sampleRate: number, channels: number): Uint8Array {
    const { ptr, len } = this.writeBytes(pcmBytes);
    try {
      const outLen = this.exports.encode_wav_wasm(ptr, len, sampleRate, channels);
      if (outLen === 0) {
        throw new Error('Rust WASM 封裝 WAV 音訊失敗');
      }
      return this.readLastOutput();
    } finally {
      this.exports.dealloc(ptr, len);
    }
  }

  optimizeGif(bytes: Uint8Array): Uint8Array {
    const { ptr, len } = this.writeBytes(bytes);
    try {
      if (!this.exports.optimize_gif_wasm(ptr, len)) throw new Error('GIF 格式不完整或超過處理上限');
      return this.readLastOutput();
    } finally {
      this.exports.dealloc(ptr, len);
    }
  }

  cleanSvg(bytes: Uint8Array, collapseWhitespace: boolean): { svg: Uint8Array; report: SvgCleanReport } {
    if (bytes.byteLength === 0) {
      throw new Error('SVG 檔案為空');
    }
    const { ptr, len } = this.writeBytes(bytes);
    try {
      const outLen = this.exports.clean_svg_wasm(ptr, len, collapseWhitespace ? 1 : 0);
      if (outLen === 0) {
        const code = this.exports.svg_last_error();
        throw new Error(SVG_ERROR_MESSAGES[code] ?? 'Rust WASM 無法清理此 SVG');
      }
      const svg = this.readLastOutput();
      this.exports.svg_last_report();
      const report = JSON.parse(textDecoder.decode(this.readLastOutput())) as SvgCleanReport;
      return { svg, report };
    } finally {
      this.exports.dealloc(ptr, len);
    }
  }
}
