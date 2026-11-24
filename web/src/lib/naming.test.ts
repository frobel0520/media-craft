import { expect, it } from 'vitest';
import { applyNameTemplate } from './naming';

const context = { index: 2, total: 12, width: 640, height: 480, ext: 'webp' };

it('expands template tokens once and preserves them inside the input name', () => {
  const actual = applyNameTemplate('{name}-{n}-{w}x{h}', {
    ...context,
    originalName: 'summer{n}{w}.jpg',
  });
  expect(actual).toBe('summer{n}{w}-02-640x480.webp');
});

it('preserves dollar replacement patterns from the input name', () => {
  const actual = applyNameTemplate('{name}-{n}', {
    ...context,
    originalName: 'sunset$&$$.jpg',
  });
  expect(actual).toBe('sunset$&$$-02.webp');
});
