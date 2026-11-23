/**
 * Output file-name templates. Tokens:
 *   {name}  original file name without extension
 *   {n}     1-based position in the queue, zero-padded to the queue size
 *   {w} {h} output width / height in pixels
 * The extension is always appended automatically.
 */

export const DEFAULT_TEMPLATE_COMPRESS = '{name}-craft';
export const DEFAULT_TEMPLATE_STRIP = '{name}-clean';
export const MAX_BASE_NAME_LENGTH = 120;

export interface NameContext {
  originalName: string;
  index: number; // 1-based
  total: number;
  width: number;
  height: number;
  ext: string;
}

// Characters illegal on Windows/macOS/Linux file systems or inside ZIP paths.
const ILLEGAL_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

export function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}

export function sanitizeBaseName(raw: string): string {
  const cleaned = raw
    .replace(ILLEGAL_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  return Array.from(cleaned).slice(0, MAX_BASE_NAME_LENGTH).join('');
}

export function applyNameTemplate(template: string, ctx: NameContext): string {
  const total = Math.max(1, ctx.total);
  const pad = String(total).length;
  const base = stripExtension(ctx.originalName);
  const rendered = template
    .replace(/\{name\}/g, base)
    .replace(/\{n\}/g, String(Math.max(1, ctx.index)).padStart(pad, '0'))
    .replace(/\{w\}/g, String(ctx.width))
    .replace(/\{h\}/g, String(ctx.height));
  const safe = sanitizeBaseName(rendered) || sanitizeBaseName(base) || 'image';
  return `${safe}.${ctx.ext}`;
}

/** Appends -2, -3 … before the extension so names inside one ZIP never collide. */
export function dedupeNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    let counter = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = name.replace(/(\.[^/.]+)?$/, (ext) => `-${counter}${ext}`);
      counter += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
