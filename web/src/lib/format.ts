export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatSavings(before: number, after: number): { label: string; reduced: boolean } {
  if (before <= 0) return { label: '0%', reduced: false };
  const diff = before - after;
  const pct = Math.round((Math.abs(diff) / before) * 100);
  if (diff >= 0) {
    return { label: `-${pct}%`, reduced: true };
  }
  return { label: `+${pct}%`, reduced: false };
}
