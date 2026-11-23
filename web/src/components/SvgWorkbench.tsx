import { useEffect, useRef, useState } from 'react';
import { formatBytes, formatSavings } from '../lib/format';
import type { SvgCleanReport } from '../types';

interface SvgWorkbenchProps {
  wasmReady: boolean;
  cleanSvg: (buffer: ArrayBuffer, collapseWhitespace: boolean) => Promise<{ buffer: ArrayBuffer; report: SvgCleanReport }>;
  buildZip: (files: Array<{ name: string; buffer: ArrayBuffer }>) => Promise<ArrayBuffer>;
}

interface SvgResult {
  blob: Blob;
  url: string;
  fileName: string;
  report: SvgCleanReport;
  durationMs: number;
}

interface SvgTask {
  id: string;
  file: File;
  status: 'processing' | 'done' | 'error';
  result: SvgResult | null;
  error: string | null;
}

function isSvgFile(file: File): boolean {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
}

function cleanFileName(name: string): string {
  return `${name.replace(/\.svg$/i, '')}-clean.svg`;
}

function triggerDownload(url: string, fileName: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
}

export function SvgWorkbench({ wasmReady, cleanSvg, buildZip }: SvgWorkbenchProps) {
  const [collapseWhitespace, setCollapseWhitespace] = useState(true);
  const [tasks, setTasks] = useState<SvgTask[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tasksRef = useRef<SvgTask[]>([]);
  tasksRef.current = tasks;

  useEffect(() => {
    return () => {
      for (const task of tasksRef.current) {
        if (task.result) URL.revokeObjectURL(task.result.url);
      }
    };
  }, []);

  const runTask = async (task: SvgTask, collapse: boolean) => {
    const start = performance.now();
    try {
      const input = await task.file.arrayBuffer();
      const { buffer, report } = await cleanSvg(input, collapse);
      const blob = new Blob([buffer], { type: 'image/svg+xml' });
      const result: SvgResult = {
        blob,
        url: URL.createObjectURL(blob),
        fileName: cleanFileName(task.file.name),
        report,
        durationMs: Math.max(1, Math.round(performance.now() - start)),
      };
      setTasks((prev) =>
        prev.map((item) => {
          if (item.id !== task.id) return item;
          if (item.result) URL.revokeObjectURL(item.result.url);
          return { ...item, status: 'done', result, error: null };
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : '清理 SVG 時發生未知錯誤';
      setTasks((prev) => prev.map((item) => (item.id === task.id ? { ...item, status: 'error', error: message } : item)));
    }
  };

  const addFiles = (fileList: FileList | File[]) => {
    const all = Array.from(fileList);
    const incoming = all.filter(isSvgFile);
    setNotice(incoming.length < all.length ? `已略過 ${all.length - incoming.length} 個非 SVG 檔案` : null);
    if (incoming.length === 0) return;
    const created: SvgTask[] = incoming.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      file,
      status: 'processing',
      result: null,
      error: null,
    }));
    setTasks((prev) => [...created, ...prev]);
    for (const task of created) void runTask(task, collapseWhitespace);
  };

  const reprocessAll = (collapse: boolean) => {
    setTasks((prev) => prev.map((item) => ({ ...item, status: 'processing', error: null })));
    for (const task of tasksRef.current) void runTask(task, collapse);
  };

  const removeTask = (id: string) => {
    setTasks((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.result) URL.revokeObjectURL(target.result.url);
      return prev.filter((item) => item.id !== id);
    });
  };

  const done = tasks.filter((task) => task.status === 'done' && task.result);
  const totalIn = done.reduce((sum, task) => sum + (task.result?.report.inputBytes ?? 0), 0);
  const totalOut = done.reduce((sum, task) => sum + (task.result?.report.outputBytes ?? 0), 0);

  const downloadZip = async () => {
    if (done.length === 0) return;
    setZipping(true);
    try {
      const files = await Promise.all(
        done.map(async (task) => ({ name: task.result!.fileName, buffer: await task.result!.blob.arrayBuffer() })),
      );
      const zip = await buildZip(files);
      const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      triggerDownload(url, 'media-craft-svg.zip');
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'ZIP 打包失敗');
    } finally {
      setZipping(false);
    }
  };

  return (
    <>
      <section className="hero">
        <h1 className="hero__title">SVG 安全清理與最佳化</h1>
        <p className="hero__desc">
          Rust WebAssembly 在瀏覽器本地移除 SVG 內的腳本、事件屬性、外部引用、編輯器資料與註解，保留 viewBox 與合法圖形，輸出可直接預覽與下載，檔案全程不離開您的裝置。
        </p>
      </section>

      <section className="panel controls" aria-label="SVG 清理設定">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={collapseWhitespace}
            onChange={(e) => {
              setCollapseWhitespace(e.target.checked);
              if (tasksRef.current.length > 0) reprocessAll(e.target.checked);
            }}
          />
          <span>移除標籤之間的空白與換行（文字內容不受影響）</span>
        </label>
        <p className="muted svg-policy">
          一律移除：&lt;script&gt;、&lt;foreignObject&gt;、on* 事件、javascript: 連結、外部圖片與樣式（含 @import）、DOCTYPE／實體、註解、&lt;metadata&gt; 與 Inkscape／Sodipodi 等編輯器資料。只保留文件內的 #id 引用與內嵌 PNG／JPEG／GIF／WebP／AVIF 圖片。
        </p>
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
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/svg+xml,.svg"
          multiple
          className="sr-only"
          id="svg-file-picker"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <p className="dropzone__title">拖放 SVG 到這裡，或點擊選取檔案（可多選）</p>
        <p className="dropzone__hint">單檔上限 20 MiB · 100% 本機處理，不會上傳至任何伺服器</p>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!wasmReady}
          onClick={() => fileInputRef.current?.click()}
        >
          {wasmReady ? '選取 SVG 檔案' : '載入 WASM 核心…'}
        </button>
      </section>

      {notice && (
        <div className="alert alert--error" role="status">
          {notice}
        </div>
      )}

      {tasks.length > 0 && (
        <section className="panel queue" aria-label="SVG 清理結果">
          <div className="queue__bar">
            <div className="queue__stats" aria-live="polite">
              <strong>
                已完成 {done.length} / {tasks.length} 個檔案
              </strong>
              {done.length > 0 && (
                <span className="muted">
                  {formatBytes(totalIn)} → {formatBytes(totalOut)}（{formatSavings(totalIn, totalOut).label}）
                </span>
              )}
            </div>
            <div className="queue__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={done.length === 0 || zipping}
                onClick={() => void downloadZip()}
              >
                {zipping ? '打包中…' : '全部下載 ZIP'}
              </button>
            </div>
          </div>

          <ul className="task-list">
            {tasks.map((task) => {
              const report = task.result?.report;
              const savings = report ? formatSavings(report.inputBytes, report.outputBytes) : null;
              return (
                <li key={task.id} className="task-card" data-testid="svg-task">
                  {task.result ? (
                    <img
                      src={task.result.url}
                      alt={`${task.file.name} 清理後預覽`}
                      className="task-card__thumb task-card__thumb--contain"
                    />
                  ) : (
                    <div className="task-card__thumb" aria-hidden="true" />
                  )}
                  <div className="task-card__body">
                    <div className="task-card__top">
                      <strong className="task-card__name">{task.file.name}</strong>
                      <span className="task-card__dims">{formatBytes(task.file.size)}</span>
                    </div>
                    {report && savings && (
                      <div className="badges">
                        <span className={`badge ${savings.reduced ? 'badge--ok' : 'badge--info'}`}>
                          輸出 {formatBytes(report.outputBytes)}（{savings.label}）· {task.result?.durationMs}ms
                        </span>
                        {report.removedActive > 0 && (
                          <span className="badge badge--warn">移除主動內容 {report.removedActive}</span>
                        )}
                        {report.removedExternal > 0 && (
                          <span className="badge badge--warn">移除外部引用 {report.removedExternal}</span>
                        )}
                        {report.removedMetadata > 0 && (
                          <span className="badge badge--info">移除中繼資料 {report.removedMetadata}</span>
                        )}
                        {report.removedActive + report.removedExternal === 0 && (
                          <span className="badge badge--ok">未發現主動內容或外部引用</span>
                        )}
                        {!report.hasViewBox && <span className="badge badge--info">原檔沒有 viewBox</span>}
                      </div>
                    )}
                    {task.status === 'processing' && <span className="muted">清理中…</span>}
                    {task.error && (
                      <p className="task-card__error" role="alert">
                        {task.error}
                      </p>
                    )}
                  </div>
                  <div className="task-card__actions">
                    {task.result && (
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => triggerDownload(task.result!.url, task.result!.fileName)}
                      >
                        下載
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
  );
}
