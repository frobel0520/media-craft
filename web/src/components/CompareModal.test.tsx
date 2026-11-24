// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ImageTask, InspectReport } from '../types';
import { CompareModal } from './CompareModal';

afterEach(cleanup);

const report: InspectReport = {
  format: 'png', mimeType: 'image/png', byteLength: 4, width: 2, height: 2,
  hasExif: false, hasGps: false, hasXmp: false, hasIcc: false, hasComments: false,
  hasPrivacyRisk: false, metadataBytes: 0, cameraMake: null, cameraModel: null,
  software: null, dateTime: null, tagsFound: [],
};
const task: ImageTask = {
  id: 'fixture', file: new File(['data'], 'fixture.png', { type: 'image/png' }),
  previewUrl: 'blob:fixture-input', status: 'done', beforeReport: report, error: null,
  output: {
    blob: new Blob(['out'], { type: 'image/png' }), url: 'blob:fixture-output',
    fileName: 'fixture-craft.png', width: 2, height: 2, byteLength: 3,
    afterReport: report, durationMs: 1,
  },
};

it('updates the comparison position when the slider moves', () => {
  render(<CompareModal task={task} onClose={vi.fn()} onDownload={vi.fn()} />);
  expect(screen.getByRole('dialog', { name: '前後畫質與隱私對比' })).toBeTruthy();
  const slider = screen.getByRole('slider', { name: '對比位置（50%）' });
  fireEvent.change(slider, { target: { value: '73' } });
  expect(screen.getByRole('slider', { name: '對比位置（73%）' })).toBeTruthy();
});

it('downloads the selected output and supports closing by Escape', () => {
  const close = vi.fn();
  const download = vi.fn();
  render(<CompareModal task={task} onClose={close} onDownload={download} />);
  fireEvent.click(screen.getByRole('button', { name: '下載處理後檔案' }));
  expect(download).toHaveBeenCalledOnce();
  expect(download).toHaveBeenCalledWith(task);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});
