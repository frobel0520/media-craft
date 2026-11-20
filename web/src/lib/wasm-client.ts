import type { InspectReport } from '../types';

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
}

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
}
