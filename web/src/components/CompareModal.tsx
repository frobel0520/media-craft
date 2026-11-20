import { useEffect, useState } from 'react';
import { formatBytes, formatSavings } from '../lib/format';
import type { ImageTask } from '../types';

interface CompareModalProps {
  task: ImageTask;
  onClose: () => void;
  onDownload: (task: ImageTask) => void;
}

export function CompareModal({ task, onClose, onDownload }: CompareModalProps) {
  const [split, setSplit] = useState(50);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!task.output) return null;
  const { output, beforeReport } = task;
  const savings = formatSavings(task.file.size, output.byteLength);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <header className="modal__head">
          <div>
            <h2 id="compare-modal-title" className="modal__title">
              前後畫質與隱私對比
            </h2>
            <p className="modal__sub">{output.fileName}</p>
          </div>
          <button
            type="button"
            className="btn btn--ghost modal__close"
            onClick={onClose}
            aria-label="關閉對比視窗"
          >
            ✕
          </button>
        </header>

        <div className="compare-stage">
          <img src={output.url} alt="處理後圖片" className="compare-stage__img" />
          <div
            className="compare-stage__before"
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
          >
            <img src={task.previewUrl} alt="原始圖片" className="compare-stage__img" />
          </div>
          <div className="compare-stage__divider" style={{ left: `${split}%` }} aria-hidden="true" />
          <span className="compare-pill compare-pill--left">原圖 · {formatBytes(task.file.size)}</span>
          <span className="compare-pill compare-pill--right">
            處理後 · {formatBytes(output.byteLength)} ({savings.label})
          </span>
        </div>

        <div className="compare-slider-row">
          <label htmlFor="compare-range" className="compare-slider-row__label">
            對比位置（{split}%）
          </label>
          <input
            id="compare-range"
            type="range"
            min={0}
            max={100}
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
          />
        </div>

        <div className="compare-meta-grid">
          <div className="meta-box">
            <span className="meta-box__label">尺寸</span>
            <strong className="meta-box__val">
              {beforeReport?.width ?? '?'}×{beforeReport?.height ?? '?'} → {output.width}×{output.height}
            </strong>
          </div>
          <div className="meta-box">
            <span className="meta-box__label">隱私中繼資料</span>
            <strong className="meta-box__val">
              {beforeReport && beforeReport.tagsFound.length > 0
                ? `已清除：${beforeReport.tagsFound.join('、')}`
                : '原圖無 EXIF / GPS'}
            </strong>
          </div>
          <div className="meta-box">
            <span className="meta-box__label">處理耗時</span>
            <strong className="meta-box__val">{output.durationMs} ms（100% 本地）</strong>
          </div>
        </div>

        <footer className="modal__foot">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            關閉
          </button>
          <button type="button" className="btn btn--primary" onClick={() => onDownload(task)}>
            下載處理後檔案
          </button>
        </footer>
      </div>
    </div>
  );
}
