const MAX_PCM_BYTES = 96 * 1024 * 1024;

export interface AudioClip {
  pcm: ArrayBuffer;
  sampleRate: number;
  channels: number;
  frames: number;
}

export function createAudioClip(source: AudioBuffer, startText: string, endText: string): AudioClip {
  const start = startText.trim() ? Number(startText) : Number.NaN;
  const end = endText.trim() ? Number(endText) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > source.duration || start >= end) {
    throw new Error('請輸入有效的開始及結束秒數');
  }

  const first = Math.round(start * source.sampleRate);
  const last = Math.min(source.length, Math.round(end * source.sampleRate));
  const frames = last - first;
  const channels = source.numberOfChannels;
  if (frames < 1) throw new Error('選取的區間太短');
  if (channels < 1 || channels > 8) throw new Error('僅支援 1 至 8 聲道音訊');
  if (frames * channels * 2 > MAX_PCM_BYTES) throw new Error('輸出太大，請縮短選取區間');

  const pcm = new ArrayBuffer(frames * channels * 2);
  const view = new DataView(pcm);
  const channelSamples = Array.from({ length: channels }, (_, channel) => source.getChannelData(channel));
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const value = Math.max(-1, Math.min(1, channelSamples[channel][first + frame]));
      const sample = Math.round(value < 0 ? value * 32768 : value * 32767);
      view.setInt16((frame * channels + channel) * 2, sample, true);
    }
  }
  return { pcm, sampleRate: source.sampleRate, channels, frames };
}
