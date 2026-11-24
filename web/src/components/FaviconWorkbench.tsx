import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '../lib/format';
import type { FaviconBundle } from '../types';

interface FaviconWorkbenchProps {
  wasmReady: boolean;
  generate: (buffer: ArrayBuffer) => Promise<FaviconBundle>;
}

function download(buffer: ArrayBuffer, type: string, name: string): void {
  const url = URL.createObjectURL(new Blob([buffer], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function FaviconWorkbench({ wasmReady, generate }: FaviconWorkbenchProps) {
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [sourceName, setSourceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<FaviconBundle | null>(null);

  useEffect(() => () => { generation.current++; }, []);

  async function build(file: File): Promise<void> {
    const current = ++generation.current;
    setSourceName(file.name);
    setBusy(true);
    setBundle(null);
    setError(null);
    try {
      const result = await generate(await file.arrayBuffer());
      if (generation.current === current) setBundle(result);
    } catch (failure) {
      if (generation.current === current) {
        setError(failure instanceof Error ? failure.message : '無法產生圖示組');
      }
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  return (
    <>
      <section className="hero">
        <h1 className="hero__title">Favicon 與 PWA 圖示</h1>
        <p className="hero__desc">用一張圖片產生網站圖示。原圖等比例置中，空白區域保留透明。</p>
      </section>
      <section className="panel" aria-label="選擇圖示來源" aria-busy={busy}>
        <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp,image/avif,image/bmp,image/x-icon,image/gif"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void build(file);
          }}
        />
        <button className="btn btn--primary" type="button" disabled={!wasmReady || busy}
          onClick={() => input.current?.click()}>
          選擇圖片
        </button>
        <p role="status">{busy ? '正在產生圖示…' : (sourceName || (!wasmReady ? '正在載入工具…' : ''))}</p>
        {error && <p className="alert alert--error" role="alert">{error}</p>}
      </section>
      {bundle && (
        <section className="panel" aria-label="圖示組下載">
          <h2>圖示組下載</h2>
          <ul>
            {bundle.files.map(({ name, size, type, buffer }) => (
              <li key={name}>
                <button className="btn" type="button" onClick={() => download(buffer, type, name)}>
                  下載 {name}
                </button>
                {' '}{size} × {size} · {formatBytes(buffer.byteLength)}
              </li>
            ))}
          </ul>
          <button className="btn btn--primary" type="button"
            onClick={() => download(bundle.zip, 'application/zip', 'favicon-pwa.zip')}>
            下載全部（ZIP）
          </button>
        </section>
      )}
    </>
  );
}
