// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import type { InspectReport, WorkerRequest, WorkerResponse } from './types';

const report: InspectReport = {
  format: 'png', mimeType: 'image/png', byteLength: 4, width: 2, height: 2,
  hasExif: false, hasGps: false, hasXmp: false, hasIcc: false, hasComments: false,
  hasPrivacyRisk: false, metadataBytes: 0, cameraMake: null, cameraModel: null,
  software: null, dateTime: null, tagsFound: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(['read', 'send', 'worker'] as const)('allows batch retry after a %s failure', async (failure) => {
  let failOnce = true;
  let releaseFailure: (() => void) | undefined;
  const dispatched: string[] = [];

  class TestWorker extends EventTarget {
    onmessage: ((message: MessageEvent<WorkerResponse>) => void) | null = null;

    postMessage(request: WorkerRequest): void {
      if (request.type === 'init') this.reply({ type: 'ready' });
      if (request.type !== 'process') return;

      dispatched.push(request.fileName);
      if (failOnce && failure === 'send') {
        failOnce = false;
        throw new DOMException('test send failure', 'DataCloneError');
      }
      if (failOnce && failure === 'worker') {
        failOnce = false;
        releaseFailure = () => this.reply({ type: 'error', id: request.id, message: 'test worker failure' });
        return;
      }

      this.reply({
        type: 'processed', id: request.id, buffer: new ArrayBuffer(4), mimeType: 'image/png',
        fileName: request.fileName, width: 2, height: 2, beforeReport: report, afterReport: report,
        durationMs: 1,
      });
    }

    reply(message: WorkerResponse): void {
      queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: message })));
    }

    terminate(): void {}
  }

  vi.stubGlobal('Worker', TestWorker);
  const { container } = render(<App />);
  const filePicker = container.querySelector('#file-picker')!;
  const files = ['first.png', 'second.png'].map((name) => {
    const file = new File(['test'], name, { type: 'image/png' });
    const read = vi.fn(async () => new ArrayBuffer(4));
    read.mockImplementationOnce(async () => new ArrayBuffer(4)); // Initial inspection.
    if (name === 'first.png' && failure === 'read') {
      read.mockImplementationOnce(() => new Promise((_, reject) => {
        releaseFailure = () => reject(new Error('test read failure'));
      }));
    }
    return Object.assign(file, { arrayBuffer: read });
  });

  fireEvent.change(filePicker, { target: { files } });
  await screen.findByText(/Rust WASM 就緒/);
  fireEvent.click(screen.getByRole('button', { name: /全部處理/ }));

  if (failure === 'send') {
    await screen.findByText(/已完成 1 張/);
    await screen.findByText('無法讀取或送出圖片，請重試');
    expect(dispatched).toEqual(['first.png', 'second.png']);
  } else {
    const cancel = await screen.findByRole('button', { name: '中止' });
    fireEvent.click(cancel);
    expect(releaseFailure).toBeTypeOf('function');
    releaseFailure!();
    await screen.findByRole('button', { name: /全部處理/ });
    const message = failure === 'read' ? '無法讀取或送出圖片，請重試' : 'test worker failure';
    await screen.findByText(message);
    expect(dispatched).not.toContain('second.png');
  }

  fireEvent.click(screen.getByRole('button', { name: /全部處理/ }));
  await screen.findByText(/已完成 2 張/);
  expect(dispatched.slice(-2)).toEqual(['first.png', 'second.png']);
});

it.each([
  ['send', '無法送出 GIF，請重試'],
  ['error', 'GIF 處理 Worker 發生錯誤，請重試'],
  ['messageerror', '無法讀取 GIF 處理結果，請重試'],
  ['timeout', 'GIF 處理逾時，請重試'],
] as const)('allows a GIF retry after a %s failure', async (failure, message) => {
  let attempts = 0;

  class GifWorker extends EventTarget {
    onmessage: ((message: MessageEvent<WorkerResponse>) => void) | null = null;

    postMessage(request: WorkerRequest): void {
      if (request.type === 'init') this.reply({ type: 'ready' });
      if (request.type !== 'gif-optimize') return;

      if (++attempts === 1) {
        if (failure === 'send') throw new DOMException('fixture send failure', 'DataCloneError');
        if (failure !== 'timeout') queueMicrotask(() => this.dispatchEvent(new Event(failure)));
        return;
      }

      this.reply({ type: 'gif-optimized', id: request.id, buffer: new ArrayBuffer(2) });
    }

    reply(message: WorkerResponse): void {
      queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: message })));
    }

    terminate(): void {}
  }

  vi.stubGlobal('Worker', GifWorker);
  render(<App />);
  await screen.findByText(/Rust WASM 就緒/);
  fireEvent.click(screen.getByRole('button', { name: 'GIF / 動圖最佳化' }));
  const panel = screen.getByRole('region', { name: 'GIF 最佳化' });
  const picker = panel.querySelector('input')!;
  const file = Object.assign(new File(['test'], 'fixture.gif', { type: 'image/gif' }), {
    arrayBuffer: async () => new ArrayBuffer(4),
  });

  if (failure === 'timeout') {
    vi.useFakeTimers();
    try {
      fireEvent.change(picker, { target: { files: [file] } });
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    } finally {
      vi.useRealTimers();
    }
  } else {
    fireEvent.change(picker, { target: { files: [file] } });
  }

  expect((await screen.findByRole('alert')).textContent).toBe(message);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '選擇 GIF' }).disabled).toBe(false);
  fireEvent.change(picker, { target: { files: [file] } });
  await screen.findByRole('button', { name: '下載最佳化 GIF' });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(attempts).toBe(2);
});
