import { useEffect, useRef, useState } from 'react';
import { createAudioClip } from '../lib/audio-clip';

interface AudioWorkbenchProps {
  wasmReady: boolean;
  encodeWav: (pcm: ArrayBuffer, sampleRate: number, channels: number) => Promise<ArrayBuffer>;
}

interface Preview {
  url: string;
  name: string;
  seconds: number;
}

export function AudioWorkbench({ wasmReady, encodeWav }: AudioWorkbenchProps) {
  const input = useRef<HTMLInputElement>(null);
  const revision = useRef(0);
  const [source, setSource] = useState<AudioBuffer | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => () => { revision.current++; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function decode(file: File): Promise<void> {
    const current = ++revision.current;
    setSourceName(file.name);
    setSource(null);
    setPreview(null);
    setError(null);
    setBusy(true);
    let context: AudioContext | undefined;
    try {
      if (!file.size || file.size > 32 * 1024 * 1024) throw new Error('請選擇 32 MiB 以內的音訊');
      context = new AudioContext();
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      if (revision.current === current) {
        setSource(decoded);
        setStart('0');
        setEnd(String(decoded.duration));
      }
    } catch (failure) {
      if (revision.current === current) {
        setError(failure instanceof Error && failure.message.includes('32 MiB')
          ? failure.message : '無法解碼，請選擇瀏覽器支援的音訊格式');
      }
    } finally {
      if (context) await context.close();
      if (revision.current === current) setBusy(false);
    }
  }

  async function preparePreview(): Promise<void> {
    if (!source) return;
    const current = ++revision.current;
    setBusy(true);
    setPreview(null);
    setError(null);
    try {
      const clip = createAudioClip(source, start, end);
      const wav = await encodeWav(clip.pcm, clip.sampleRate, clip.channels);
      if (revision.current === current) {
        setPreview({
          url: URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })),
          name: sourceName.replace(/\.[^/.]+$/, '') + '-clip.wav',
          seconds: clip.frames / clip.sampleRate,
        });
      }
    } catch (failure) {
      if (revision.current === current) setError(failure instanceof Error ? failure.message : '無法匯出選取區間');
    } finally {
      if (revision.current === current) setBusy(false);
    }
  }

  return (
    <>
      <section className="hero">
        <h1 className="hero__title">音訊片段剪輯</h1>
        <p className="hero__desc">選擇一段音訊，試聽後匯出 WAV。</p>
      </section>
      <section className="panel" aria-label="音訊來源" aria-busy={busy}>
        <input ref={input} type="file" hidden accept="audio/*,.wav,.ogg,.m4a" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void decode(file);
        }} />
        <button className="btn btn--primary" type="button" disabled={busy}
          onClick={() => input.current?.click()}>選擇音訊</button>
        <p role="status">{busy ? '正在處理…' : sourceName}</p>
        {error && <p role="alert" className="alert alert--error">{error}</p>}
      </section>
      {source && (
        <section className="panel controls" aria-label="選取音訊區間">
          <div className="controls-grid">
            <label className="field">
              <span className="field__label">開始秒數</span>
              <input className="field__input" type="number" min={0} max={source.duration} step="any" value={start} disabled={busy}
                onChange={(event) => { setStart(event.currentTarget.value); setPreview(null); setError(null); }} />
            </label>
            <label className="field">
              <span className="field__label">結束秒數</span>
              <input className="field__input" type="number" min={0} max={source.duration} step="any" value={end} disabled={busy}
                onChange={(event) => { setEnd(event.currentTarget.value); setPreview(null); setError(null); }} />
            </label>
          </div>
          <button className="btn btn--primary" type="button" disabled={busy || !wasmReady}
            onClick={() => void preparePreview()}>產生試聽與 WAV</button>
          {preview && (
            <div>
              <p>片段長度 {preview.seconds.toFixed(3)} 秒</p>
              <audio controls preload="metadata" src={preview.url} aria-label="試聽選取區間" className="video-result__audio" />
              <p><a className="btn btn--secondary" href={preview.url} download={preview.name}>下載 WAV</a></p>
            </div>
          )}
        </section>
      )}
    </>
  );
}
