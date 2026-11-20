import { useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes } from '../lib/format';

type VideoMode = 'transcode' | 'extract-wav' | 'snapshot';
type VideoOutputFormat = 'video/webm' | 'video/mp4';
type SnapshotFormat = 'image/webp' | 'image/png' | 'image/jpeg';

interface VideoWorkbenchProps {
  wasmReady: boolean;
  encodeWav: (pcmBuffer: ArrayBuffer, sampleRate: number, channels: number) => Promise<ArrayBuffer>;
}

interface VideoResult {
  url: string;
  fileName: string;
  byteLength: number;
  mimeType: string;
  durationMs: number;
}

const VIDEO_RES_PRESETS = [
  { label: '維持原解析度', value: 0 },
  { label: '最大 1080p（寬 ≤ 1920）', value: 1920 },
  { label: '最大 720p（寬 ≤ 1280）', value: 1280 },
  { label: '最大 480p（寬 ≤ 854）', value: 854 },
];

const BITRATE_PRESETS = [
  { label: '高畫質（6 Mbps）', value: 6_000_000 },
  { label: '標準（3 Mbps）', value: 3_000_000 },
  { label: '輕量（1.5 Mbps）', value: 1_500_000 },
];

function pickRecorderMime(target: VideoOutputFormat): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates =
    target === 'video/mp4'
      ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=h264,aac', 'video/mp4']
      : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm'];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VideoWorkbench({ wasmReady, encodeWav }: VideoWorkbenchProps) {
  const [mode, setMode] = useState<VideoMode>('transcode');
  const [videoFormat, setVideoFormat] = useState<VideoOutputFormat>('video/webm');
  const [maxWidth, setMaxWidth] = useState<number>(1280);
  const [bitrate, setBitrate] = useState<number>(3_000_000);
  const [keepAudio, setKeepAudio] = useState<boolean>(true);
  const [snapshotFormat, setSnapshotFormat] = useState<SnapshotFormat>('image/webp');

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ width: number; height: number; duration: number } | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VideoResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const supportedMp4 = useMemo(() => pickRecorderMime('video/mp4') !== null, []);
  const supportedWebm = useMemo(() => pickRecorderMime('video/webm') !== null, []);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  useEffect(() => {
    return () => {
      if (result?.url) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  const handleSelectFile = (selected: File | null) => {
    if (!selected) return;
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (result?.url) URL.revokeObjectURL(result.url);
    setResult(null);
    setError(null);
    setMeta(null);
    setProgress(0);
    setFile(selected);
    setVideoUrl(URL.createObjectURL(selected));
  };

  const baseName = file ? file.name.replace(/\.[^/.]+$/, '') : 'video';

  const handleTranscode = async () => {
    if (!file || !videoUrl) return;
    const mime = pickRecorderMime(videoFormat);
    if (!mime) {
      setError(`目前瀏覽器不支援本地 ${videoFormat === 'video/mp4' ? 'MP4' : 'WebM'} 編碼，請改選另一種格式`);
      return;
    }

    setBusy(true);
    setError(null);
    setProgress(0);
    if (result?.url) URL.revokeObjectURL(result.url);
    setResult(null);

    const startTime = performance.now();
    const hiddenVideo = document.createElement('video');
    hiddenVideo.src = videoUrl;
    hiddenVideo.muted = !keepAudio;
    hiddenVideo.playsInline = true;
    hiddenVideo.crossOrigin = 'anonymous';

    let rafId = 0;
    let audioCtx: AudioContext | null = null;
    let recorder: MediaRecorder | null = null;
    let cancelled = false;

    const cleanup = () => {
      cancelAnimationFrame(rafId);
      hiddenVideo.pause();
      hiddenVideo.src = '';
      if (audioCtx) {
        void audioCtx.close();
        audioCtx = null;
      }
    };

    abortRef.current = () => {
      cancelled = true;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      cleanup();
      setBusy(false);
      setProgress(0);
    };

    try {
      await new Promise<void>((resolve, reject) => {
        hiddenVideo.onloadedmetadata = () => resolve();
        hiddenVideo.onerror = () => reject(new Error('無法解碼此影片檔案，瀏覽器可能不支援此編碼格式'));
      });

      let targetW = hiddenVideo.videoWidth || 1280;
      let targetH = hiddenVideo.videoHeight || 720;
      if (maxWidth > 0 && targetW > maxWidth) {
        const scale = maxWidth / targetW;
        targetW = Math.max(2, Math.round((targetW * scale) / 2) * 2);
        targetH = Math.max(2, Math.round((targetH * scale) / 2) * 2);
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('無法建立 Canvas 2D 繪圖環境');

      const stream = canvas.captureStream(30);
      if (keepAudio) {
        try {
          audioCtx = new AudioContext();
          const source = audioCtx.createMediaElementSource(hiddenVideo);
          const dest = audioCtx.createMediaStreamDestination();
          source.connect(dest);
          for (const track of dest.stream.getAudioTracks()) {
            stream.addTrack(track);
          }
        } catch {
          // Video may have no audio track; continue video-only
        }
      }

      const chunks: Blob[] = [];
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: bitrate,
      });
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };

      const donePromise = new Promise<Blob>((resolve, reject) => {
        if (!recorder) return reject(new Error('MediaRecorder 初始化失敗'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: videoFormat }));
        recorder.onerror = () => reject(new Error('影片轉檔過程中發生編碼錯誤'));
      });

      const drawLoop = () => {
        if (cancelled) return;
        ctx.drawImage(hiddenVideo, 0, 0, targetW, targetH);
        if (hiddenVideo.duration > 0) {
          setProgress(Math.min(99, Math.round((hiddenVideo.currentTime / hiddenVideo.duration) * 100)));
        }
        if (!hiddenVideo.paused && !hiddenVideo.ended) {
          rafId = requestAnimationFrame(drawLoop);
        }
      };

      recorder.start(250);
      hiddenVideo.onended = () => {
        setProgress(100);
        if (recorder && recorder.state !== 'inactive') {
          recorder.stop();
        }
      };

      await hiddenVideo.play();
      drawLoop();

      const outBlob = await donePromise;
      if (cancelled) return;

      const ext = videoFormat === 'video/mp4' ? 'mp4' : 'webm';
      setResult({
        url: URL.createObjectURL(outBlob),
        fileName: `${baseName}-craft.${ext}`,
        byteLength: outBlob.size,
        mimeType: videoFormat,
        durationMs: Math.max(1, Math.round(performance.now() - startTime)),
      });
    } catch (err) {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : '影片轉檔失敗');
      }
    } finally {
      abortRef.current = null;
      cleanup();
      setBusy(false);
    }
  };

  const handleExtractWav = async () => {
    if (!file || !wasmReady) return;
    setBusy(true);
    setError(null);
    setProgress(25);
    if (result?.url) URL.revokeObjectURL(result.url);
    setResult(null);

    const startTime = performance.now();
    const audioCtx = new AudioContext();
    try {
      const arrayBuf = await file.arrayBuffer();
      setProgress(50);
      const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
      const channels = Math.min(2, audioBuf.numberOfChannels);
      const length = audioBuf.length;
      const pcm = new Int16Array(length * channels);
      const channelData = Array.from({ length: channels }, (_, ch) => audioBuf.getChannelData(ch));

      for (let i = 0; i < length; i++) {
        for (let ch = 0; ch < channels; ch++) {
          const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
          pcm[i * channels + ch] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
      }

      setProgress(80);
      const wavBuffer = await encodeWav(pcm.buffer, audioBuf.sampleRate, channels);
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
      setProgress(100);
      setResult({
        url: URL.createObjectURL(wavBlob),
        fileName: `${baseName}-audio.wav`,
        byteLength: wavBlob.size,
        mimeType: 'audio/wav',
        durationMs: Math.max(1, Math.round(performance.now() - startTime)),
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? `音訊抽離失敗：${err.message}`
          : '無法從此影片解碼音訊軌（可能無音軌或瀏覽器不支援該音訊編碼）',
      );
    } finally {
      void audioCtx.close();
      setBusy(false);
    }
  };

  const handleSnapshot = async () => {
    const videoEl = videoRef.current;
    if (!videoEl || !file) return;
    setBusy(true);
    setError(null);
    if (result?.url) URL.revokeObjectURL(result.url);
    setResult(null);

    const startTime = performance.now();
    try {
      const w = videoEl.videoWidth;
      const h = videoEl.videoHeight;
      if (!w || !h) throw new Error('請等待影片載入完成後再擷取封面');

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('無法建立 Canvas 繪圖環境');
      ctx.drawImage(videoEl, 0, 0, w, h);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('擷取封面失敗'))),
          snapshotFormat,
          snapshotFormat === 'image/png' ? undefined : 0.92,
        );
      });
      const ext = snapshotFormat === 'image/png' ? 'png' : snapshotFormat === 'image/jpeg' ? 'jpg' : 'webp';
      setResult({
        url: URL.createObjectURL(blob),
        fileName: `${baseName}-frame.${ext}`,
        byteLength: blob.size,
        mimeType: snapshotFormat,
        durationMs: Math.max(1, Math.round(performance.now() - startTime)),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '擷取封面失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="hero">
        <h1 className="hero__title">影片轉檔、抽離無損音訊與封面擷取</h1>
        <p className="hero__desc">
          100% 瀏覽器本地硬體加速與 Rust WebAssembly 封裝，支援 MP4、WebM、MOV、OGV 影片轉檔、一鍵抽離無損 WAV 音訊與時間軸高畫質截圖，檔案全程不離開您的裝置。
        </p>
      </section>

      <section className="panel controls" aria-label="影片處理設定">
        <div className="mode-switch mode-switch--three" role="radiogroup" aria-label="影片處理模式">
          {(
            [
              { id: 'transcode', title: '影片轉檔', desc: '轉為 WebM / MP4 並調整解析度與位元率' },
              { id: 'extract-wav', title: '抽離音訊（WAV）', desc: 'Rust WASM 封裝 16-bit 無損 WAV 音檔' },
              { id: 'snapshot', title: '擷取封面圖', desc: '精準時間軸擷取 WebP / PNG / JPEG 畫面' },
            ] as Array<{ id: VideoMode; title: string; desc: string }>
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={mode === item.id}
              className={`mode-card ${mode === item.id ? 'mode-card--active' : ''}`}
              onClick={() => {
                setMode(item.id);
                setError(null);
              }}
            >
              <strong>{item.title}</strong>
              <span>{item.desc}</span>
            </button>
          ))}
        </div>

        {mode === 'transcode' && (
          <div className="controls-grid">
            <div className="field">
              <label htmlFor="video-output-format" className="field__label">
                輸出格式
              </label>
              <select
                id="video-output-format"
                className="field__input"
                value={videoFormat}
                onChange={(e) => setVideoFormat(e.target.value as VideoOutputFormat)}
              >
                <option value="video/webm" disabled={!supportedWebm}>
                  WebM（VP9/VP8 網頁高壓縮）{supportedWebm ? '' : ' — 此瀏覽器不支援'}
                </option>
                <option value="video/mp4" disabled={!supportedMp4}>
                  MP4（H.264 通用相容）{supportedMp4 ? '' : ' — 此瀏覽器不支援'}
                </option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="video-max-width" className="field__label">
                解析度上限
              </label>
              <select
                id="video-max-width"
                className="field__input"
                value={maxWidth}
                onChange={(e) => setMaxWidth(Number(e.target.value))}
              >
                {VIDEO_RES_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="video-bitrate" className="field__label">
                畫質位元率
              </label>
              <select
                id="video-bitrate"
                className="field__input"
                value={bitrate}
                onChange={(e) => setBitrate(Number(e.target.value))}
              >
                {BITRATE_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={keepAudio}
                  onChange={(e) => setKeepAudio(e.target.checked)}
                />
                <span>保留原始音訊軌</span>
              </label>
            </div>
          </div>
        )}

        {mode === 'snapshot' && (
          <div className="controls-grid">
            <div className="field">
              <label htmlFor="snapshot-format" className="field__label">
                封面輸出格式
              </label>
              <select
                id="snapshot-format"
                className="field__input"
                value={snapshotFormat}
                onChange={(e) => setSnapshotFormat(e.target.value as SnapshotFormat)}
              >
                <option value="image/webp">WebP（高畫質小體積）</option>
                <option value="image/png">PNG（無損畫質）</option>
                <option value="image/jpeg">JPEG（通用相容）</option>
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
          if (e.dataTransfer.files?.[0]) {
            handleSelectFile(e.dataTransfer.files[0]);
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/ogg,.mp4,.m4v,.webm,.mov,.ogv"
          className="sr-only"
          id="video-file-picker"
          onChange={(e) => {
            if (e.target.files?.[0]) {
              handleSelectFile(e.target.files[0]);
              e.target.value = '';
            }
          }}
        />
        <p className="dropzone__title">
          {file ? `已選取：${file.name}` : '拖放影片到這裡，或點擊選取檔案'}
        </p>
        <p className="dropzone__hint">
          支援 MP4、WebM、MOV、OGV · 100% 本機處理，不會上傳至任何伺服器
        </p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => fileInputRef.current?.click()}
        >
          {file ? '更換影片檔案' : '選取影片檔案'}
        </button>
      </section>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {file && videoUrl && (
        <section className="panel video-stage" aria-label="影片預覽與執行">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            className="video-player"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setMeta({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
            }}
          />

          <div className="video-bar">
            <div className="queue__stats" aria-live="polite">
              <strong>{file.name}</strong>
              <span className="muted">
                {formatBytes(file.size)}
                {meta ? ` · ${meta.width}×${meta.height} · ${formatDuration(meta.duration)}` : ''}
              </span>
            </div>

            <div className="queue__actions">
              {mode === 'transcode' && (
                <>
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() => void handleTranscode()}
                  >
                    {busy ? `轉檔中 ${progress}%…` : `開始轉為 ${videoFormat === 'video/mp4' ? 'MP4' : 'WebM'}`}
                  </button>
                  {busy && (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => abortRef.current?.()}
                    >
                      中止
                    </button>
                  )}
                </>
              )}

              {mode === 'extract-wav' && (
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy || !wasmReady}
                  onClick={() => void handleExtractWav()}
                >
                  {busy ? `Rust 封裝中 ${progress}%…` : '抽離為無損 WAV'}
                </button>
              )}

              {mode === 'snapshot' && (
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy}
                  onClick={() => void handleSnapshot()}
                >
                  擷取目前畫面
                </button>
              )}
            </div>
          </div>

          {busy && (
            <div className="progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="progress-track__fill" style={{ width: `${progress}%` }} />
            </div>
          )}

          {result && (
            <div className="video-result" aria-live="polite">
              <div className="video-result__info">
                <strong>處理完成：{result.fileName}</strong>
                <span className="muted">
                  輸出 {formatBytes(result.byteLength)} · 耗時 {result.durationMs}ms
                </span>
              </div>
              {result.mimeType === 'audio/wav' && <audio src={result.url} controls className="video-result__audio" />}
              {result.mimeType.startsWith('image/') && (
                <img src={result.url} alt="擷取的影片封面" className="video-result__thumb" />
              )}
              <a href={result.url} download={result.fileName} className="btn btn--primary">
                下載檔案
              </a>
            </div>
          )}
        </section>
      )}
    </>
  );
}
