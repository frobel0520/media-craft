import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioWorkbench } from './components/AudioWorkbench';
import { CompareModal } from './components/CompareModal';
import { FaviconWorkbench } from './components/FaviconWorkbench';
import { GifWorkbench } from './components/GifWorkbench';
import { SvgWorkbench } from './components/SvgWorkbench';
import { VideoWorkbench } from './components/VideoWorkbench';
import { formatBytes, formatSavings } from './lib/format';
import { formatOutputFileName, isAcceptedImageFile } from './lib/image-file';
import type {
  CropRatio,
  FaviconBundle,
  ImageTask,
  OutputFormat,
  ProcessMode,
  ProcessOptions,
  RotationDeg,
  SvgCleanReport,
  WorkerRequest,
  WorkerResponse,
} from './types';

const MAX_WIDTH_PRESETS = [
  { label: '維持原尺寸', value: 0 },
  { label: '最大 2560 px', value: 2560 },
  { label: '最大 1920 px', value: 1920 },
  { label: '最大 1280 px', value: 1280 },
  { label: '最大 800 px', value: 800 },
];

type ModuleId = 'image' | 'video' | 'svg' | 'favicon' | 'gif' | 'audio';

const CORE_MODULES: Array<{ id: ModuleId; label: string; title: string }> = [
  { id: 'image', label: '圖片壓縮與轉檔', title: '圖片工作台' },
  { id: 'video', label: '影片轉檔', title: '影片轉檔' },
  { id: 'svg', label: 'SVG 清理壓縮', title: 'SVG 清理' },
  { id: 'favicon', label: 'Favicon / PWA 圖示', title: 'Favicon 與 PWA 圖示' },
  { id: 'gif', label: 'GIF / 動圖最佳化', title: 'GIF 最佳化' },
  { id: 'audio', label: '音訊剪輯與轉檔', title: '音訊剪輯' },
];

function ModuleIcon({ id }: { id: ModuleId }) {
  switch (id) {
    case 'image':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <circle cx="8.5" cy="9.5" r="1.5" />
          <path d="m21 15-4.5-4.5L9 18" />
        </svg>
      );
    case 'video':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="5" width="14" height="14" rx="2.5" />
          <path d="m16.5 10 5-3v10l-5-3v-4Z" />
        </svg>
      );
    case 'svg':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3 4 9l8 6 8-6-8-6Z" />
          <path d="m4 15 8 6 8-6" />
        </svg>
      );
    case 'favicon':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </svg>
      );
    case 'gif':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="m10 9 5 3-5 3V9Z" />
        </svg>
      );
    case 'audio':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12v2M8 8v8M12 5v14M16 9v6M20 11v2" />
        </svg>
      );
  }
}

type ThemePreference = 'system' | 'light' | 'dark';

const THEME_OPTIONS: Array<{ id: ThemePreference; label: string }> = [
  { id: 'system', label: '系統' },
  { id: 'light', label: '淺色' },
  { id: 'dark', label: '深色' },
];

function getInitialTheme(): ThemePreference {
  try {
    const saved = window.localStorage.getItem('media-craft.theme');
    if (saved === 'system' || saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Ignore storage restriction
  }
  return 'system';
}

function getInitialSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem('media-craft.sidebar') === 'collapsed';
  } catch {
    return false;
  }
}

function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function App() {
  const [activeModule, setActiveModule] = useState<ModuleId>('image');
  const [theme, setTheme] = useState<ThemePreference>(getInitialTheme);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(getInitialSidebarCollapsed);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [wasmReady, setWasmReady] = useState(false);
  const [wasmError, setWasmError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [options, setOptions] = useState<ProcessOptions>({
    mode: 'compress',
    outputFormat: 'image/webp',
    quality: 82,
    maxWidth: 0,
    rotate: 0,
    flipH: false,
    flipV: false,
    cropRatio: 'original',
    fileNameTemplate: '{name}-craft',
  });

  const workerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const batchCancelRef = useRef(false);
  const nextImageRequest = useRef(0);
  const pendingImageTasks = useRef(new Map<string, {
    requestId: string;
    done: Promise<void>;
    finish: () => void;
  }>());
  const wavPendingRef = useRef<
    Map<string, { resolve: (buf: ArrayBuffer) => void; reject: (err: Error) => void }>
  >(new Map());
  const svgPendingRef = useRef<
    Map<string, { resolve: (res: { buffer: ArrayBuffer; report: SvgCleanReport }) => void; reject: (err: Error) => void }>
  >(new Map());
  const zipPendingRef = useRef<
    Map<string, { resolve: (buf: ArrayBuffer) => void; reject: (err: Error) => void }>
  >(new Map());
  const faviconPendingRef = useRef(new Map<string, {
    resolve: (bundle: FaviconBundle) => void;
    reject: (error: Error) => void;
  }>());
  const gifPendingRef = useRef(new Map<string, {
    resolve: (buffer: ArrayBuffer) => void;
    reject: (error: Error) => void;
  }>());
  const tasksRef = useRef<ImageTask[]>([]);
  tasksRef.current = tasks;

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme);
    };
    apply();
    try {
      window.localStorage.setItem('media-craft.theme', theme);
    } catch {
      // Ignore storage restriction
    }
    if (theme !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem('media-craft.sidebar', sidebarCollapsed ? 'collapsed' : 'expanded');
    } catch {
      // Ignore storage restriction
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileNavOpen]);

  const failImageTask = useCallback((id: string, error: string, onlyIdle = false) => {
    setTasks((prev) => prev.map((task) =>
      task.id === id && (!onlyIdle || task.status === 'idle')
        ? { ...task, status: 'error', error }
        : task,
    ));
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL('./workers/media.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    const wasmUrl = new URL(`${import.meta.env.BASE_URL}wasm/media_wasm.wasm`, window.location.href).href;
    const pending = pendingImageTasks.current;
    let initialized = false;

    const failPendingImages = (error: string) => {
      if (!initialized) setWasmError(error);
      for (const [id, operation] of pending) {
        failImageTask(id, error);
        operation.finish();
      }
    };
    worker.addEventListener('error', () => failPendingImages('圖片處理 Worker 發生錯誤，請重試'));
    worker.addEventListener('messageerror', () => failPendingImages('無法讀取圖片處理結果，請重試'));

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'ready') {
        initialized = true;
        setWasmReady(true);
        setWasmError(null);
        return;
      }
      if (msg.type === 'inspected') {
        const id = msg.id.slice('inspect:'.length);
        setTasks((prev) =>
          prev.map((item) => (item.id === id ? { ...item, beforeReport: msg.report } : item)),
        );
        return;
      }
      if (msg.type === 'processed') {
        const id = msg.id.split(':', 1)[0];
        const operation = pending.get(id);
        if (operation?.requestId !== msg.id) return;
        const blob = new Blob([msg.buffer], { type: msg.mimeType });
        const url = URL.createObjectURL(blob);
        setTasks((prev) =>
          prev.map((item) => {
            if (item.id !== id) return item;
            if (item.output?.url) URL.revokeObjectURL(item.output.url);
            return {
              ...item,
              status: 'done',
              beforeReport: msg.beforeReport,
              error: null,
              output: {
                blob,
                url,
                fileName: msg.fileName,
                width: msg.width,
                height: msg.height,
                byteLength: blob.size,
                afterReport: msg.afterReport,
                durationMs: msg.durationMs,
              },
            };
          }),
        );
        operation.finish();
        return;
      }
      if (msg.type === 'svg-cleaned') {
        const pending = svgPendingRef.current.get(msg.id);
        if (pending) {
          svgPendingRef.current.delete(msg.id);
          pending.resolve({ buffer: msg.buffer, report: msg.report });
        }
        return;
      }
      if (msg.type === 'zipped') {
        const zipPending = zipPendingRef.current.get(msg.id);
        if (zipPending) {
          zipPendingRef.current.delete(msg.id);
          zipPending.resolve(msg.buffer);
          return;
        }
        setZipping(false);
        const zipBlob = new Blob([msg.buffer], { type: 'application/zip' });
        const url = URL.createObjectURL(zipBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'media-craft-batch.zip';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
        return;
      }
      if (msg.type === 'wav-encoded') {
        const pending = wavPendingRef.current.get(msg.id);
        if (pending) {
          wavPendingRef.current.delete(msg.id);
          pending.resolve(msg.buffer);
        }
        return;
      }
      if (msg.type === 'favicon-generated') {
        const pending = faviconPendingRef.current.get(msg.id);
        faviconPendingRef.current.delete(msg.id);
        pending?.resolve(msg.bundle);
        return;
      }
      if (msg.type === 'gif-optimized') {
        const pending = gifPendingRef.current.get(msg.id);
        gifPendingRef.current.delete(msg.id);
        pending?.resolve(msg.buffer);
        return;
      }
      if (msg.type === 'error') {
        if (msg.id === 'init') {
          setWasmError(msg.message);
          return;
        }
        if (msg.id === 'zip-batch') {
          setZipping(false);
          return;
        }
        const faviconPending = faviconPendingRef.current.get(msg.id);
        if (faviconPending) {
          faviconPendingRef.current.delete(msg.id);
          faviconPending.reject(new Error(msg.message));
          return;
        }
        const gifPending = gifPendingRef.current.get(msg.id);
        if (gifPending) {
          gifPendingRef.current.delete(msg.id);
          gifPending.reject(new Error(msg.message));
          return;
        }
        const svgPending = svgPendingRef.current.get(msg.id);
        if (svgPending) {
          svgPendingRef.current.delete(msg.id);
          svgPending.reject(new Error(msg.message));
          return;
        }
        const zipPending = zipPendingRef.current.get(msg.id);
        if (zipPending) {
          zipPendingRef.current.delete(msg.id);
          zipPending.reject(new Error(msg.message));
          return;
        }
        const wavPending = wavPendingRef.current.get(msg.id);
        if (wavPending) {
          wavPendingRef.current.delete(msg.id);
          wavPending.reject(new Error(msg.message));
          return;
        }
        if (msg.id.startsWith('inspect:')) {
          failImageTask(msg.id.slice('inspect:'.length), msg.message, true);
          return;
        }
        const id = msg.id.split(':', 1)[0];
        const operation = pending.get(id);
        if (operation?.requestId === msg.id) {
          failImageTask(id, msg.message);
          operation.finish();
        }
      }
    };

    const initMsg: WorkerRequest = { type: 'init', wasmUrl };
    worker.postMessage(initMsg);

    return () => {
      worker.terminate();
      workerRef.current = null;
      for (const operation of pending.values()) operation.finish();
      for (const task of tasksRef.current) {
        URL.revokeObjectURL(task.previewUrl);
        if (task.output?.url) URL.revokeObjectURL(task.output.url);
      }
    };
  }, [failImageTask]);

  const encodeWavViaWorker = useCallback(
    (pcmBuffer: ArrayBuffer, sampleRate: number, channels: number): Promise<ArrayBuffer> => {
      const worker = workerRef.current;
      if (!worker) return Promise.reject(new Error('WASM Worker 尚未就緒'));
      const id = `wav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      return new Promise<ArrayBuffer>((resolve, reject) => {
        wavPendingRef.current.set(id, { resolve, reject });
        const req: WorkerRequest = { type: 'encode-wav', id, pcmBuffer, sampleRate, channels };
        worker.postMessage(req, [pcmBuffer]);
      });
    },
    [],
  );

  const generateFavicon = useCallback((buffer: ArrayBuffer): Promise<FaviconBundle> => {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error('圖示工具尚未就緒'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      faviconPendingRef.current.set(id, { resolve, reject });
      const request: WorkerRequest = { type: 'favicon-bundle', id, buffer };
      worker.postMessage(request, [buffer]);
    });
  }, []);

  const optimizeGif = useCallback((buffer: ArrayBuffer): Promise<ArrayBuffer> => {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error('GIF 工具尚未就緒'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      gifPendingRef.current.set(id, { resolve, reject });
      const request: WorkerRequest = { type: 'gif-optimize', id, buffer };
      worker.postMessage(request, [buffer]);
    });
  }, []);

  const cleanSvgViaWorker = useCallback(
    (buffer: ArrayBuffer, collapseWhitespace: boolean): Promise<{ buffer: ArrayBuffer; report: SvgCleanReport }> => {
      const worker = workerRef.current;
      if (!worker) return Promise.reject(new Error('WASM Worker 尚未就緒'));
      const id = `svg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      return new Promise((resolve, reject) => {
        svgPendingRef.current.set(id, { resolve, reject });
        const req: WorkerRequest = { type: 'svg-clean', id, buffer, collapseWhitespace };
        worker.postMessage(req, [buffer]);
      });
    },
    [],
  );

  const zipViaWorker = useCallback(
    (files: Array<{ name: string; buffer: ArrayBuffer }>): Promise<ArrayBuffer> => {
      const worker = workerRef.current;
      if (!worker) return Promise.reject(new Error('WASM Worker 尚未就緒'));
      const id = `zip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      return new Promise((resolve, reject) => {
        zipPendingRef.current.set(id, { resolve, reject });
        const req: WorkerRequest = { type: 'zip', id, files };
        worker.postMessage(
          req,
          files.map((f) => f.buffer),
        );
      });
    },
    [],
  );

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter(isAcceptedImageFile);
    if (incoming.length === 0) return;

    const created: ImageTask[] = incoming.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'idle',
      beforeReport: null,
      output: null,
      error: null,
    }));

    setTasks((prev) => [...created, ...prev]);

    const worker = workerRef.current;
    if (!worker) return;

    for (const item of created) {
      try {
        const buffer = await item.file.arrayBuffer();
        const req: WorkerRequest = { type: 'inspect', id: `inspect:${item.id}`, buffer };
        worker.postMessage(req, [buffer]);
      } catch {
        failImageTask(item.id, '無法讀取或檢查圖片，請重試', true);
      }
    }
  }, [failImageTask]);

  const processTask = useCallback(
    async (task: ImageTask, opts: ProcessOptions, index?: number) => {
      const worker = workerRef.current;
      if (!worker || !wasmReady) return;
      const pending = pendingImageTasks.current;
      const existing = pending.get(task.id);
      if (existing) return existing.done;

      setTasks((prev) =>
        prev.map((item) => (item.id === task.id ? { ...item, status: 'processing', error: null } : item)),
      );
      const requestId = `${task.id}:${++nextImageRequest.current}`;
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      const operation = {
        requestId,
        done,
        finish() {
          pending.delete(task.id);
          resolveDone();
        },
      };
      pending.set(task.id, operation);

      try {
        const buffer = await task.file.arrayBuffer();
        if (pending.get(task.id) === operation) {
          const req: WorkerRequest = {
            type: 'process',
            id: requestId,
            fileName: task.file.name,
            buffer,
            options: opts,
            index,
          };
          worker.postMessage(req, [buffer]);
        }
      } catch {
        if (pending.get(task.id) === operation) {
          failImageTask(task.id, '無法讀取或送出圖片，請重試');
          operation.finish();
        }
      }
      return done;
    },
    [failImageTask, wasmReady],
  );

  const processAll = useCallback(async () => {
    if (tasks.length === 0) return;
    batchCancelRef.current = false;
    setBatchProgress({ done: 0, total: tasks.length });
    try {
      for (let i = 0; i < tasks.length; i++) {
        if (batchCancelRef.current) break;
        await processTask(tasks[i], options, i + 1);
        setBatchProgress({ done: i + 1, total: tasks.length });
      }
    } finally {
      setBatchProgress(null);
      batchCancelRef.current = false;
    }
  }, [tasks, options, processTask]);

  const cancelBatch = useCallback(() => {
    batchCancelRef.current = true;
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => {
      const target = prev.find((t) => t.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        if (target.output?.url) URL.revokeObjectURL(target.output.url);
      }
      return prev.filter((t) => t.id !== id);
    });
    setCompareId((curr) => (curr === id ? null : curr));
  }, []);

  const clearAll = useCallback(() => {
    for (const task of tasks) {
      URL.revokeObjectURL(task.previewUrl);
      if (task.output?.url) URL.revokeObjectURL(task.output.url);
    }
    setTasks([]);
    setCompareId(null);
  }, [tasks]);

  const downloadSingle = useCallback((task: ImageTask) => {
    if (!task.output) return;
    const link = document.createElement('a');
    link.href = task.output.url;
    link.download = task.output.fileName;
    link.click();
  }, []);

  const downloadBatchZip = useCallback(async () => {
    const worker = workerRef.current;
    const readyItems = tasks.filter((t) => t.status === 'done' && t.output);
    if (!worker || readyItems.length === 0) return;

    setZipping(true);
    const usedNames = new Set<string>();
    const files: Array<{ name: string; buffer: ArrayBuffer }> = [];
    const transfers: Transferable[] = [];

    for (const item of readyItems) {
      if (!item.output) continue;
      let name = item.output.fileName;
      let counter = 2;
      while (usedNames.has(name)) {
        name = item.output.fileName.replace(/(\.[^/.]+)$/, `-${counter}$1`);
        counter += 1;
      }
      usedNames.add(name);
      const buffer = await item.output.blob.arrayBuffer();
      files.push({ name, buffer });
      transfers.push(buffer);
    }

    const req: WorkerRequest = { type: 'zip', id: 'zip-batch', files };
    worker.postMessage(req, transfers);
  }, [tasks]);

  const summary = useMemo(() => {
    const done = tasks.filter((t) => t.status === 'done' && t.output);
    const totalBefore = done.reduce((acc, t) => acc + t.file.size, 0);
    const totalAfter = done.reduce((acc, t) => acc + (t.output?.byteLength ?? 0), 0);
    const strippedCount = done.filter((t) => t.beforeReport?.hasPrivacyRisk).length;
    return {
      doneCount: done.length,
      totalBefore,
      totalAfter,
      savings: formatSavings(totalBefore, totalAfter),
      strippedCount,
    };
  }, [tasks]);

  const compareTask = useMemo(
    () => tasks.find((t) => t.id === compareId && t.output !== null) ?? null,
    [tasks, compareId],
  );

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__inner">
          <div className="topbar__left">
            <button
              type="button"
              className="icon-btn topbar__menu-mobile"
              onClick={() => setMobileNavOpen((open) => !open)}
              aria-label={mobileNavOpen ? '關閉導覽側邊欄' : '開啟導覽側邊欄'}
              aria-expanded={mobileNavOpen}
              aria-controls="workbench-sidebar"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <button
              type="button"
              className="icon-btn topbar__menu-desktop"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={sidebarCollapsed ? '展開側邊欄' : '收合側邊欄'}
              aria-expanded={!sidebarCollapsed}
              aria-controls="workbench-sidebar"
              title={sidebarCollapsed ? '展開側邊欄' : '收合側邊欄'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2.5" />
                <path d="M9 4v16" />
              </svg>
            </button>

            <div className="brand">
              <img
                src={`${import.meta.env.BASE_URL}favicon.svg`}
                alt=""
                width={32}
                height={32}
                className="brand__icon"
              />
              <span className="brand__name">media-craft</span>
              <span className="brand__sep" aria-hidden="true">/</span>
              <span className="brand__module">
                {CORE_MODULES.find((mod) => mod.id === activeModule)?.title}
              </span>
            </div>
          </div>

          <div className="topbar__right">
            <span className="privacy-pill" title="瀏覽器 CSP 鎖定 connect-src 'self'，檔案絕不外傳">
              <span className={`dot ${wasmReady ? 'dot--ok' : ''}`} aria-hidden="true" />
              <span className="privacy-pill__text">
                {wasmReady ? 'Rust WASM 就緒 · 零上傳' : '載入 WASM 核心…'}
              </span>
            </span>
            <div className="theme-switch" role="radiogroup" aria-label="外觀主題">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={theme === opt.id}
                  className={`theme-switch__btn ${theme === opt.id ? 'theme-switch__btn--active' : ''}`}
                  onClick={() => setTheme(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className={`workbench ${sidebarCollapsed ? 'workbench--collapsed' : ''}`}>
        {mobileNavOpen && (
          <div
            className="sidebar-backdrop"
            aria-hidden="true"
            onClick={() => setMobileNavOpen(false)}
          />
        )}

        <aside
          id="workbench-sidebar"
          className={`sidebar ${sidebarCollapsed ? 'sidebar--collapsed' : ''} ${mobileNavOpen ? 'sidebar--mobile-open' : ''}`}
          aria-label="多媒體模組導覽"
        >
          <div className="sidebar__section">
            <div className="sidebar__label">核心工具</div>
            {CORE_MODULES.map((mod) => (
              <button
                key={mod.id}
                type="button"
                className={`sidebar-item ${activeModule === mod.id ? 'sidebar-item--active' : ''}`}
                aria-current={activeModule === mod.id ? 'page' : undefined}
                title={mod.label}
                onClick={() => {
                  setActiveModule(mod.id);
                  setMobileNavOpen(false);
                }}
              >
                <span className="sidebar-item__icon">
                  <ModuleIcon id={mod.id} />
                </span>
                <span className="sidebar-item__text">{mod.label}</span>
              </button>
            ))}
          </div>

          <div className="sidebar__foot">
            <div className="sidebar-trust" title="所有檔案皆於瀏覽器本地 Rust WASM 運算，絕不上傳">
              <span className={`dot ${wasmReady ? 'dot--ok' : ''}`} aria-hidden="true" />
              <div className="sidebar-trust__body">
                <strong>100% 本地離線</strong>
                <span>CSP 鎖定零上傳</span>
              </div>
            </div>
          </div>
        </aside>

        <div className="workspace">
          <main className="main">
            {activeModule === 'svg' ? (
              <SvgWorkbench wasmReady={wasmReady} cleanSvg={cleanSvgViaWorker} buildZip={zipViaWorker} />
            ) : activeModule === 'favicon' ? (
              <FaviconWorkbench wasmReady={wasmReady} generate={generateFavicon} />
            ) : activeModule === 'gif' ? (
              <GifWorkbench wasmReady={wasmReady} optimize={optimizeGif} />
            ) : activeModule === 'video' ? (
              <VideoWorkbench wasmReady={wasmReady} encodeWav={encodeWavViaWorker} />
            ) : activeModule === 'audio' ? (
              <AudioWorkbench wasmReady={wasmReady} encodeWav={encodeWavViaWorker} />
            ) : (
              <>
        <section className="hero">
          <h1 className="hero__title">圖片壓縮、格式轉換與無損去 EXIF</h1>
          <p className="hero__desc">
            由純 Rust 編譯的 WebAssembly 核心在瀏覽器背景執行，支援自動剝離 GPS 座標與相機資訊、批次轉為 WebP／JPEG／PNG 與一鍵打包 ZIP，所有檔案全程留在您的裝置內。
          </p>
        </section>

        {wasmError && (
          <div className="alert alert--error" role="alert">
            {wasmError}
          </div>
        )}

        <section className="panel controls" aria-label="處理設定">
          <div className="mode-switch" role="radiogroup" aria-label="處理模式">
            {(
              [
                {
                  id: 'compress',
                  title: '壓縮與格式轉換',
                  desc: '調整品質、縮放尺寸、轉 WebP/JPEG/PNG 並自動清除 EXIF',
                },
                {
                  id: 'lossless-strip',
                  title: '純無損去 EXIF',
                  desc: 'Rust 直接從二進位移除 GPS／相機／註解，0% 畫質損失',
                },
              ] as Array<{ id: ProcessMode; title: string; desc: string }>
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={options.mode === item.id}
                className={`mode-card ${options.mode === item.id ? 'mode-card--active' : ''}`}
                onClick={() => setOptions((prev) => ({ ...prev, mode: item.id }))}
              >
                <strong>{item.title}</strong>
                <span>{item.desc}</span>
              </button>
            ))}
          </div>

          {options.mode === 'compress' && (
            <div className="controls-grid">
              <div className="field">
                <label htmlFor="output-format" className="field__label">
                  輸出格式
                </label>
                <select
                  id="output-format"
                  className="field__input"
                  value={options.outputFormat}
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, outputFormat: e.target.value as OutputFormat }))
                  }
                >
                  <option value="image/webp">WebP（體積最小，網頁首選）</option>
                  <option value="image/jpeg">JPEG（通用相容性最高）</option>
                  <option value="image/png">PNG（無損透明背景）</option>
                  <option value="image/avif">AVIF（次世代高壓縮，依瀏覽器支援）</option>
                  <option value="image/bmp">BMP（Rust 無壓縮 24-bit 位圖）</option>
                  <option value="image/x-icon">ICO（Rust 圖示封裝，自動 ≤ 256px）</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="quality-range" className="field__label">
                  壓縮品質：
                  {options.outputFormat === 'image/png' ||
                  options.outputFormat === 'image/bmp' ||
                  options.outputFormat === 'image/x-icon'
                    ? '無損'
                    : `${options.quality}%`}
                </label>
                <input
                  id="quality-range"
                  type="range"
                  min={10}
                  max={100}
                  step={1}
                  disabled={
                    options.outputFormat === 'image/png' ||
                    options.outputFormat === 'image/bmp' ||
                    options.outputFormat === 'image/x-icon'
                  }
                  value={options.quality}
                  onChange={(e) => setOptions((prev) => ({ ...prev, quality: Number(e.target.value) }))}
                />
              </div>

              <div className="field">
                <label htmlFor="max-width" className="field__label">
                  尺寸限制（不放大）
                </label>
                <select
                  id="max-width"
                  className="field__input"
                  value={options.maxWidth}
                  onChange={(e) => setOptions((prev) => ({ ...prev, maxWidth: Number(e.target.value) }))}
                >
                  {MAX_WIDTH_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="crop-ratio" className="field__label">
                  智慧置中裁切比例
                </label>
                <select
                  id="crop-ratio"
                  className="field__input"
                  value={options.cropRatio}
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, cropRatio: e.target.value as CropRatio }))
                  }
                >
                  <option value="original">維持原比例</option>
                  <option value="1:1">1:1（正方形頭像／IG）</option>
                  <option value="4:3">4:3（標準簡報／相片）</option>
                  <option value="16:9">16:9（寬螢幕封面）</option>
                  <option value="3:2">3:2（經典單眼相片）</option>
                  <option value="9:16">9:16（直式短影音封面）</option>
                </select>
              </div>

              <div className="field">
                <span className="field__label">
                  旋轉與翻轉
                  {options.rotate !== 0 || options.flipH || options.flipV
                    ? `（${options.rotate}°${options.flipH ? ' · 水平翻轉' : ''}${options.flipV ? ' · 垂直翻轉' : ''}）`
                    : ''}
                </span>
                <div className="transform-toolbar" role="group" aria-label="旋轉與翻轉">
                  <button
                    type="button"
                    className="btn btn--secondary btn--compact"
                    onClick={() =>
                      setOptions((prev) => ({
                        ...prev,
                        rotate: (((prev.rotate + 270) % 360) as RotationDeg),
                      }))
                    }
                    title="逆時針旋轉 90°"
                  >
                    ↺ 90°
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary btn--compact"
                    onClick={() =>
                      setOptions((prev) => ({
                        ...prev,
                        rotate: (((prev.rotate + 90) % 360) as RotationDeg),
                      }))
                    }
                    title="順時針旋轉 90°"
                  >
                    ↻ 90°
                  </button>
                  <button
                    type="button"
                    className={`btn btn--secondary btn--compact ${options.flipH ? 'btn--active' : ''}`}
                    aria-pressed={options.flipH}
                    onClick={() => setOptions((prev) => ({ ...prev, flipH: !prev.flipH }))}
                    title="水平翻轉"
                  >
                    ⇄ 水平
                  </button>
                  <button
                    type="button"
                    className={`btn btn--secondary btn--compact ${options.flipV ? 'btn--active' : ''}`}
                    aria-pressed={options.flipV}
                    onClick={() => setOptions((prev) => ({ ...prev, flipV: !prev.flipV }))}
                    title="垂直翻轉"
                  >
                    ⇅ 垂直
                  </button>
                  {(options.rotate !== 0 || options.flipH || options.flipV) && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--compact"
                      onClick={() =>
                        setOptions((prev) => ({ ...prev, rotate: 0, flipH: false, flipV: false }))
                      }
                    >
                      重設
                    </button>
                  )}
                </div>
              </div>

              <div className="field">
                <label htmlFor="filename-template" className="field__label">
                  自訂檔名規則
                </label>
                <input
                  id="filename-template"
                  type="text"
                  className="field__input"
                  value={options.fileNameTemplate}
                  placeholder="{name}-craft"
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, fileNameTemplate: e.target.value }))
                  }
                />
                <span className="field__hint">
                  可用 {'{name}'} {'{width}'} {'{height}'} {'{index}'} · 預覽：
                  {formatOutputFileName(
                    'photo.jpg',
                    options.outputFormat === 'image/jpeg'
                      ? 'jpg'
                      : options.outputFormat === 'image/x-icon'
                        ? 'ico'
                        : options.outputFormat.replace('image/', ''),
                    options.fileNameTemplate,
                    { width: 1280, height: 720, index: 1 },
                  )}
                </span>
              </div>
            </div>
          )}
        </section>

        <section
          className={`dropzone ${dragActive ? 'dropzone--active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (e.dataTransfer.files?.length) {
              void addFiles(e.dataTransfer.files);
            }
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/svg+xml,image/x-icon,.avif,.svg,.ico"
            multiple
            className="sr-only"
            id="file-picker"
            onChange={(e) => {
              if (e.target.files?.length) {
                void addFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />
          <p className="dropzone__title">拖放圖片到這裡，或點擊選取多個檔案</p>
          <p className="dropzone__hint">
            支援 JPEG、PNG、WebP、AVIF、GIF、BMP、SVG、ICO · 單檔上限 100 MB · 不會上傳至任何伺服器
          </p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => fileInputRef.current?.click()}
          >
            選取圖片檔案
          </button>
        </section>

        {tasks.length > 0 && (
          <section className="panel queue" aria-label="處理佇列">
            <div className="queue__bar">
              <div className="queue__stats" aria-live="polite">
                <strong>共 {tasks.length} 張圖片</strong>
                {summary.doneCount > 0 && (
                  <span className="muted">
                    已完成 {summary.doneCount} 張 · {formatBytes(summary.totalBefore)} →{' '}
                    {formatBytes(summary.totalAfter)}（{summary.savings.label}）
                    {summary.strippedCount > 0 && ` · 已清除 ${summary.strippedCount} 張隱私標籤`}
                  </span>
                )}
              </div>
              <div className="queue__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!wasmReady || batchProgress !== null}
                  onClick={() => void processAll()}
                >
                  {batchProgress
                    ? `處理中 ${batchProgress.done}/${batchProgress.total}…`
                    : `全部處理（${tasks.length}）`}
                </button>
                {batchProgress && (
                  <button type="button" className="btn btn--ghost" onClick={cancelBatch}>
                    中止
                  </button>
                )}
                {summary.doneCount >= 2 && (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={zipping || batchProgress !== null}
                    onClick={() => void downloadBatchZip()}
                  >
                    {zipping ? 'Rust 打包中…' : `打包下載 ZIP（${summary.doneCount}）`}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={batchProgress !== null}
                  onClick={clearAll}
                >
                  清空
                </button>
              </div>
            </div>

            {batchProgress && (
              <div
                className="progress-track"
                role="progressbar"
                aria-valuenow={Math.round((batchProgress.done / batchProgress.total) * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="progress-track__fill"
                  style={{ width: `${Math.round((batchProgress.done / batchProgress.total) * 100)}%` }}
                />
              </div>
            )}

            <ul className="task-list">
              {tasks.map((task) => {
                const report = task.beforeReport;
                const savings = task.output
                  ? formatSavings(task.file.size, task.output.byteLength)
                  : null;
                return (
                  <li key={task.id} className="task-card">
                    <img
                      src={task.output?.url ?? task.previewUrl}
                      alt={task.file.name}
                      className="task-card__thumb"
                    />
                    <div className="task-card__body">
                      <div className="task-card__top">
                        <strong className="task-card__name">{task.file.name}</strong>
                        <span className="task-card__dims">
                          {report?.width && report?.height
                            ? `${report.width}×${report.height}`
                            : '解析中…'}
                          {' · '}
                          {formatBytes(task.file.size)}
                        </span>
                      </div>

                      <div className="badges">
                        {report && report.hasGps && (
                          <span className="badge badge--warn">偵測到 GPS 座標</span>
                        )}
                        {report && report.tagsFound.length > 0 && (
                          <span className="badge badge--info">
                            {task.status === 'done' ? '已清除' : '含中繼資料'}：
                            {report.tagsFound.join(' / ')}
                            {report.cameraModel ? `（${report.cameraModel}）` : ''}
                          </span>
                        )}
                        {report && !report.hasPrivacyRisk && (
                          <span className="badge badge--ok">無 EXIF / GPS</span>
                        )}
                        {task.output && savings && (
                          <span className={`badge ${savings.reduced ? 'badge--ok' : 'badge--info'}`}>
                            輸出 {formatBytes(task.output.byteLength)}（{savings.label}）·{' '}
                            {task.output.durationMs}ms
                          </span>
                        )}
                      </div>

                      {task.error && (
                        <p className="task-card__error" role="alert">
                          {task.error}
                        </p>
                      )}
                    </div>

                    <div className="task-card__actions">
                      {task.status === 'done' && task.output ? (
                        <>
                          <button
                            type="button"
                            className="btn btn--secondary"
                            onClick={() => setCompareId(task.id)}
                          >
                            對比
                          </button>
                          <button
                            type="button"
                            className="btn btn--primary"
                            onClick={() => downloadSingle(task)}
                          >
                            下載
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--secondary"
                          disabled={!wasmReady || task.status === 'processing'}
                          onClick={() => void processTask(task, options)}
                        >
                          {task.status === 'processing' ? '處理中…' : '處理'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => removeTask(task.id)}
                        aria-label={`移除 ${task.file.name}`}
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
              </>
            )}
          </main>

          <footer className="footer">
            <p>
              media-craft · 純 Rust WebAssembly 核心（<code>media-core</code> + <code>media-wasm</code>）· 100% 本機離線運算
            </p>
          </footer>
        </div>
      </div>

      {compareTask && (
        <CompareModal
          task={compareTask}
          onClose={() => setCompareId(null)}
          onDownload={downloadSingle}
        />
      )}
    </div>
  );
}
