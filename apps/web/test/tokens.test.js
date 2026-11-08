import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vyapar parity Phase 0, P0-S1 acceptance: with the new look on, every CSS variable the app reads has a value, and
// the colours that carry text meet WCAG contrast.

const SRC = join(import.meta.dirname, '../src');
const read = (p) => readFileSync(join(SRC, p), 'utf8');

function filesUnder(dir, exts) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return filesUnder(p, exts);
    return exts.some((e) => name.endsWith(e)) ? [p] : [];
  });
}

// Variables some component sets on itself (inline or in a scoped rule) before reading them.
const LOCAL = /^--(ad-|pdf-|pill-color|text-muted-safe)/;

const used = new Set();
for (const f of filesUnder(SRC, ['.css', '.jsx', '.js', '.tsx', '.ts'])) {
  for (const m of readFileSync(f, 'utf8').matchAll(/var\((--[a-zA-Z0-9-]+)/g)) used.add(m[1]);
}

const definedIn = (css) => new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));

describe('design tokens', () => {
  const tokens = read('styles/tokens.css');
  const vyapar = read('styles/theme-vyapar.css');

  it('defines every variable the app reads once the new look is on', () => {
    const defined = new Set([...definedIn(tokens), ...definedIn(vyapar)]);
    const missing = [...used].filter((v) => !LOCAL.test(v) && !defined.has(v));
    expect(missing).toEqual([]);
  });

  it('leaves the classic token values untouched', () => {
    // The classic block is the first :root; its brand colour is the one the classic screens were built on.
    const classic = tokens.slice(0, tokens.indexOf('[data-theme="dark"]'));
    expect(classic).toContain('--primary: #16a34a;');
    expect(classic).toContain('--bg: #f6f8f6;');
    expect(classic).toContain('--text-muted: #9ca3af;');
  });

  it('switches the classic names to the new set only under data-ui="vyapar"', () => {
    expect(vyapar).toMatch(/:root\[data-ui='vyapar'\]\s*{[^}]*--primary: var\(--cta\)/);
    expect(vyapar).not.toMatch(/^:root\s*{/m);
  });
});

// WCAG 2 relative luminance and contrast ratio.
const lum = (hex) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const value = (css, block, name) => {
  const start = css.indexOf(block);
  const body = css.slice(start, css.indexOf('}', start));
  return new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(body)?.[1];
};

describe('contrast', () => {
  const tokens = read('styles/tokens.css');
  const newRoot = '/* ---- New token set';
  const ledgoraCta = value(tokens, newRoot, '--cta');
  const vyaparCta = value(tokens, ':root[data-brand="vyapar"]', '--cta');
  const sidebarBg = value(tokens, newRoot, '--sidebar-bg');
  const sidebarFg = value(tokens, newRoot, '--sidebar-fg');
  const darkBlock = '[data-theme="dark"] {\n  --link';

  it('white on the primary button is at least 4.5:1 in both brands', () => {
    expect(contrast('#ffffff', ledgoraCta)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', vyaparCta)).toBeGreaterThanOrEqual(4.5);
  });

  it('sidebar text is at least 7:1 in light and dark', () => {
    expect(contrast(sidebarFg, sidebarBg)).toBeGreaterThanOrEqual(7);
    expect(
      contrast(value(tokens, darkBlock, '--sidebar-fg'), value(tokens, darkBlock, '--sidebar-bg')),
    ).toBeGreaterThanOrEqual(7);
  });

  it('muted labels and links pass 4.5:1 on cards', () => {
    expect(contrast('#6b7280', '#ffffff')).toBeGreaterThanOrEqual(4.5); // --text-muted on --surface
    expect(contrast(value(tokens, newRoot, '--link'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(value(tokens, darkBlock, '--link'), value(tokens, darkBlock, '--surface')),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
