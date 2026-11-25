import { useEffect, useRef, useState } from 'react';
import { formatBytes, formatSavings } from '../lib/format';

interface GifWorkbenchProps {
  wasmReady: boolean;
  optimize: (buffer: ArrayBuffer) => Promise<ArrayBuffer>;
}

function saveGif(file: Blob, filename: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function GifWorkbench({ wasmReady, optimize }: GifWorkbenchProps) {
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [source, setSource] = useState<File | null>(null);
  const [optimized, setOptimized] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { generation.current++; }, []);

  async function optimizeFile(file: File): Promise<void> {
    const current = ++generation.current;
    setSource(file);
    setOptimized(null);
    setError(null);
    setBusy(true);
    try {
      if (!file.size || file.size > 32 * 1024 * 1024) throw new Error('請選擇 32 MiB 以內的 GIF');
      const result = await optimize(await file.arrayBuffer());
      if (current === generation.current) setOptimized(new Blob([result], { type: 'image/gif' }));
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : '無法最佳化 GIF');
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  const smaller = Boolean(source && optimized && optimized.size < source.size);

  return (
    <>
      <section className="hero">
        <h1 className="hero__title">GIF 最佳化</h1>
        <p className="hero__desc">精簡 GIF 的資料區塊與註解，保留影格、速度、循環及透明度。</p>
      </section>
      <section className="panel" aria-label="GIF 最佳化" aria-busy={busy}>
        <input ref={input} type="file" hidden accept="image/gif,.gif" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void optimizeFile(file);
        }} />
        <button className="btn btn--primary" type="button" disabled={!wasmReady || busy}
          onClick={() => input.current?.click()}>選擇 GIF</button>
        <p role="status">{busy ? '正在最佳化…' : source?.name}</p>
        {error && <p className="alert alert--error" role="alert">{error}</p>}
      </section>
      {source && optimized && (
        <section className="panel" aria-label="GIF 輸出">
          <h2>最佳化結果</h2>
          <p>原始 {formatBytes(source.size)} · 最佳化後 {formatBytes(optimized.size)}</p>
          {smaller ? (
            <>
              <p>節省 {formatSavings(source.size, optimized.size).label}</p>
              <button className="btn btn--primary" type="button"
                onClick={() => saveGif(optimized, source.name.replace(/\.gif$/i, '') + '-optimized.gif')}>
                下載最佳化 GIF
              </button>
            </>
          ) : <p>檔案已經精簡，可下載原始版本。</p>}
          <button className="btn btn--secondary" type="button" onClick={() => saveGif(source, source.name)}>下載原檔</button>
        </section>
      )}
    </>
  );
}
