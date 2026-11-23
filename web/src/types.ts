export type OutputFormat =
  | 'image/webp'
  | 'image/jpeg'
  | 'image/png'
  | 'image/avif'
  | 'image/bmp'
  | 'image/x-icon';

export type ProcessMode = 'compress' | 'lossless-strip';

export interface InspectReport {
  format: 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'bmp' | 'svg' | 'ico' | 'unknown';
  mimeType: string;
  byteLength: number;
  width: number | null;
  height: number | null;
  hasExif: boolean;
  hasGps: boolean;
  hasXmp: boolean;
  hasIcc: boolean;
  hasComments: boolean;
  hasPrivacyRisk: boolean;
  metadataBytes: number;
  cameraMake: string | null;
  cameraModel: string | null;
  software: string | null;
  dateTime: string | null;
  tagsFound: string[];
}

export interface ProcessOptions {
  mode: ProcessMode;
  outputFormat: OutputFormat;
  quality: number; // 10..100
  maxWidth: number; // 0 = keep original
}

export interface ProcessedOutput {
  blob: Blob;
  url: string;
  fileName: string;
  width: number;
  height: number;
  byteLength: number;
  afterReport: InspectReport;
  durationMs: number;
}

export interface ImageTask {
  id: string;
  file: File;
  previewUrl: string;
  status: 'idle' | 'processing' | 'done' | 'error';
  beforeReport: InspectReport | null;
  output: ProcessedOutput | null;
  error: string | null;
}

export type WorkerRequest =
  | { type: 'init'; wasmUrl: string }
  | { type: 'inspect'; id: string; buffer: ArrayBuffer }
  | { type: 'process'; id: string; fileName: string; buffer: ArrayBuffer; options: ProcessOptions }
  | { type: 'zip'; id: string; files: Array<{ name: string; buffer: ArrayBuffer }> }
  | { type: 'encode-wav'; id: string; pcmBuffer: ArrayBuffer; sampleRate: number; channels: number }
  | { type: 'favicon-bundle'; id: string; buffer: ArrayBuffer }
  | { type: 'svg-clean'; id: string; buffer: ArrayBuffer; collapseWhitespace: boolean };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'inspected'; id: string; report: InspectReport }
  | {
      type: 'processed';
      id: string;
      buffer: ArrayBuffer;
      mimeType: string;
      fileName: string;
      width: number;
      height: number;
      beforeReport: InspectReport;
      afterReport: InspectReport;
      durationMs: number;
    }
  | { type: 'zipped'; id: string; buffer: ArrayBuffer }
  | { type: 'wav-encoded'; id: string; buffer: ArrayBuffer }
  | { type: 'favicon-generated'; id: string; bundle: FaviconBundle }
  | { type: 'svg-cleaned'; id: string; buffer: ArrayBuffer; report: SvgCleanReport }
  | { type: 'error'; id: string; message: string };

export interface FaviconBundle {
  files: Array<{ name: string; size: number; type: string; buffer: ArrayBuffer }>;
  zip: ArrayBuffer;
}

/** Report produced by the Rust SVG sanitizer (`media_core::svg`). */
export interface SvgCleanReport {
  inputBytes: number;
  outputBytes: number;
  removedActive: number;
  removedExternal: number;
  removedMetadata: number;
  hasViewBox: boolean;
}
