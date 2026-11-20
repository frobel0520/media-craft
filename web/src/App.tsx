import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CompareModal } from './components/CompareModal';
import { formatBytes, formatSavings } from './lib/format';
import type {
  ImageTask,
  OutputFormat,
  ProcessMode,
  ProcessOptions,
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

const UPCOMING_MODULES = [
  { id: 'audio', label: '音訊剪輯與轉檔', note: '規劃中' },
  { id: 'gif', label: 'GIF / 動圖最佳化', note: '規劃中' },
  { id: 'svg', label: 'SVG 清理壓縮', note: '規劃中' },
];

function getInitialTheme(): 'light' | 'dark' {
  try {
    const saved = window.localStorage.getItem('media-craft.theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Ignore storage restriction
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [wasmReady, setWasmReady] = useState(false);
  const [wasmError, setWasmError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [options, setOptions] = useState<ProcessOptions>({
    mode: 'compress',
    outputFormat: 'image/webp',
    quality: 82,
    maxWidth: 0,
  });

  const workerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tasksRef = useRef<ImageTask[]>([]);
  tasksRef.current = tasks;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('media-craft.theme', theme);
    } catch {
      // Ignore storage restriction
    }
  }, [theme]);

  useEffect(() => {
    const worker = new Worker(new URL('./workers/media.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    const wasmUrl = new URL(`${import.meta.env.BASE_URL}wasm/media_wasm.wasm`, window.location.href).href;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'ready') {
        setWasmReady(true);
        setWasmError(null);
        return;
      }
      if (msg.type === 'inspected') {
        setTasks((prev) =>
          prev.map((item) => (item.id === msg.id ? { ...item, beforeReport: msg.report } : item)),
        );
        return;
      }
      if (msg.type === 'processed') {
        const blob = new Blob([msg.buffer], { type: msg.mimeType });
        const url = URL.createObjectURL(blob);
        setTasks((prev) =>
          prev.map((item) => {
            if (item.id !== msg.id) return item;
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
        return;
      }
      if (msg.type === 'zipped') {
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
      if (msg.type === 'error') {
        if (msg.id === 'init') {
          setWasmError(msg.message);
          return;
        }
        if (msg.id === 'zip-batch') {
          setZipping(false);
          return;
        }
        setTasks((prev) =>
          prev.map((item) =>
            item.id === msg.id ? { ...item, status: 'error', error: msg.message } : item,
          ),
        );
      }
    };

    const initMsg: WorkerRequest = { type: 'init', wasmUrl };
    worker.postMessage(initMsg);

    return () => {
      worker.terminate();
      workerRef.current = null;
      for (const task of tasksRef.current) {
        URL.revokeObjectURL(task.previewUrl);
        if (task.output?.url) URL.revokeObjectURL(task.output.url);
      }
    };
  }, []);

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name));
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
      const buffer = await item.file.arrayBuffer();
      const req: WorkerRequest = { type: 'inspect', id: item.id, buffer };
      worker.postMessage(req, [buffer]);
    }
  }, []);

  const processTask = useCallback(
    async (task: ImageTask, opts: ProcessOptions) => {
      const worker = workerRef.current;
      if (!worker || !wasmReady) return;

      setTasks((prev) =>
        prev.map((item) => (item.id === task.id ? { ...item, status: 'processing', error: null } : item)),
      );
      const buffer = await task.file.arrayBuffer();
      const req: WorkerRequest = {
        type: 'process',
        id: task.id,
        fileName: task.file.name,
        buffer,
        options: opts,
      };
      worker.postMessage(req, [buffer]);
    },
    [wasmReady],
  );

  const processAll = useCallback(async () => {
    for (const task of tasks) {
      await processTask(task, options);
    }
  }, [tasks, options, processTask]);

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
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              MC
            </span>
            <div>
              <div className="brand__name">media-craft</div>
              <div className="brand__tag">Rust + WebAssembly 本地多媒體工作台</div>
            </div>
          </div>

          <div className="topbar__right">
            <span className="privacy-pill" title="瀏覽器 CSP 鎖定 connect-src 'self'，檔案絕不外傳">
              <span className={`dot ${wasmReady ? 'dot--ok' : ''}`} aria-hidden="true" />
              {wasmReady ? 'Rust WASM 就緒 · 零上傳' : '載入 WASM 核心…'}
            </span>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label={theme === 'dark' ? '切換為淺色主題' : '切換為深色主題'}
            >
              {theme === 'dark' ? '☀ 淺色' : '☾ 深色'}
            </button>
          </div>
        </div>

        <nav className="module-nav" aria-label="多媒體模組">
          <div className="module-nav__inner">
            <button type="button" className="module-tab module-tab--active" aria-current="page">
              圖片壓縮與轉檔
            </button>
            {UPCOMING_MODULES.map((mod) => (
              <span key={mod.id} className="module-tab module-tab--soon" aria-disabled="true">
                {mod.label}
                <small>{mod.note}</small>
              </span>
            ))}
          </div>
        </nav>
      </header>

      <main className="main">
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
                </select>
              </div>

              <div className="field">
                <label htmlFor="quality-range" className="field__label">
                  壓縮品質：{options.outputFormat === 'image/png' ? '無損' : `${options.quality}%`}
                </label>
                <input
                  id="quality-range"
                  type="range"
                  min={10}
                  max={100}
                  step={1}
                  disabled={options.outputFormat === 'image/png'}
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
            accept="image/jpeg,image/png,image/webp,image/gif,image/bmp"
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
          <p className="dropzone__hint">支援 JPEG、PNG、WebP、GIF、BMP · 單檔上限 100 MB · 不會上傳至任何伺服器</p>
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
              <div className="queue__stats">
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
                  disabled={!wasmReady}
                  onClick={() => void processAll()}
                >
                  全部處理（{tasks.length}）
                </button>
                {summary.doneCount >= 2 && (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={zipping}
                    onClick={() => void downloadBatchZip()}
                  >
                    {zipping ? 'Rust 打包中…' : `打包下載 ZIP（${summary.doneCount}）`}
                  </button>
                )}
                <button type="button" className="btn btn--ghost" onClick={clearAll}>
                  清空
                </button>
              </div>
            </div>

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
      </main>

      <footer className="footer">
        <p>
          media-craft · 純 Rust WebAssembly 核心（<code>media-core</code> + <code>media-wasm</code>）· 100% 本機離線運算
        </p>
      </footer>

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
