// BLK-047: the opt-in premium look (src/premium.css) is token overrides only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const css = readFileSync(join(root, 'src/premium.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = readFileSync(join(root, 'src/tokens.css'), 'utf8');
const kit = readFileSync(join(root, 'src/kit.css'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** The --mk-* names set inside the block that opens at `selector`. */
function block(selector) {
  const at = css.indexOf(selector);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return [...body.matchAll(/(--mk-[\w-]+)\s*:/g)].map((m) => m[1]).sort();
}

// Theme-independent tokens are set once, on :root only.
const SHARED = ['--mk-btn-radius', '--mk-font', '--mk-radius-lg', '--mk-text-h1', '--mk-weight-title'];

describe('premium.css (BLK-047)', () => {
  it('is exported as @mn/blocks/premium.css', () => {
    expect(pkg.exports['./premium.css']).toBe('./src/premium.css');
  });

  it('only overrides tokens the kit already defines, and styles no components', () => {
    const light = block(':root {');
    expect(light.length).toBeGreaterThan(25);
    // A kit token in tokens.css, or an optional one kit.css reads with a fallback.
    for (const t of light) expect(new RegExp(`${t}\\s*:`).test(tokens) || kit.includes(`var(${t},`), t).toBe(true);
    expect(css).not.toMatch(/\.mk-/);
    expect(css.match(/[^{}]+\{/g).map((s) => s.trim().replace(/\s*\{$/, ''))).toEqual([
      ':root', '@media (prefers-color-scheme: dark)', ":root:not([data-theme='light'])", ":root[data-theme='dark']",
    ]);
  });

  it('sets every theme-dependent light token in both dark blocks', () => {
    const light = block(':root {').filter((t) => !SHARED.includes(t));
    expect(block(":root:not([data-theme='light']) {")).toEqual(light);
    expect(block(":root[data-theme='dark'] {")).toEqual(light);
  });

  it('is the blue accent, system font first and true-black dark', () => {
    expect(css).toMatch(/--mk-primary:\s*#0071e3;/);
    expect(css).toMatch(/--mk-font:\s*-apple-system, BlinkMacSystemFont/);
    expect(css).toMatch(/--mk-bg:\s*#000000;/);
  });

  it('makes buttons pills, secondary a soft fill and disabled neutral (BLK-048)', () => {
    expect(css).toMatch(/--mk-btn-radius:\s*999px;/);
    expect(css.match(/--mk-btn-secondary-border:\s*transparent;/g)).toHaveLength(3);
    expect(css.match(/--mk-btn-disabled-opacity:\s*1;/g)).toHaveLength(3);
    for (const v of ['primary', 'accent', 'danger']) expect(kit).toContain(`.mk-btn-${v}:is(:disabled, [aria-disabled='true']) { background: var(--mk-btn-disabled-bg, var(--mk-`);
  });

  it('keeps white text on the blue button in both themes', () => {
    expect(css.match(/--mk-primary-fg:\s*#ffffff;/g)).toHaveLength(3);
  });
});
