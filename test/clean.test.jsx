import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { cleanRichHtml, cleanRichNodes, safeHref, installRichTrustedTypes, RICH_TAGS, GOOGLE_GSI_URL } from '../src/editor/clean.js';
import { RichText } from '../src/editor/RichText.jsx';
import * as lite from '../src/editor/lite.js';
import { EDITOR_TAGS, NOTE_TAGS, sanitizeRich } from '../server/richText.js';

afterEach(cleanup);

describe('cleanRichHtml', () => {
  it('uses the same tag list as the server', () => {
    expect([...RICH_TAGS].sort()).toEqual([...EDITOR_TAGS].sort());
  });
  it('drops script, handlers, styles and images, keeps the text', () => {
    expect(cleanRichHtml('<p style="color:red" onclick="x()">Hi <img src=x onerror=alert(1)><script>alert(1)</script><b>there</b></p>'))
      .toBe('<p>Hi <strong>there</strong></p>');
  });
  it('drops svg, iframes, templates and noscript with their content', () => {
    expect(cleanRichHtml('<p>a<svg><script>x</script><text>t</text></svg><iframe srcdoc="<b>x</b>"></iframe><template><b>t</b></template><noscript><b>n</b></noscript>b</p>'))
      .toBe('<p>ab</p>');
  });
  it('unwraps unknown tags and attributes, renames div/b/i', () => {
    expect(cleanRichHtml('<div class="x"><span id="y"><i>a</i></span></div>')).toBe('<p><em>a</em></p>');
  });
  it('keeps safe links only and forces rel/target', () => {
    expect(cleanRichHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a rel="noopener noreferrer" target="_blank">x</a>');
    expect(cleanRichHtml('<a href="java\tscript:alert(1)">x</a>')).not.toContain('href');
    expect(cleanRichHtml('<a href=" JaVaScRiPt:alert(1)">x</a>')).not.toContain('href');
    expect(cleanRichHtml('<a href="data:text/html,hi">x</a>')).not.toContain('data:');
    expect(cleanRichHtml('<a href="https://a.com" onclick="y" title="t">x</a>'))
      .toBe('<a href="https://a.com" title="t" rel="noopener noreferrer" target="_blank">x</a>');
    expect(cleanRichHtml('<a href="/p/1?qa=2">x</a>')).toContain('href="/p/1?qa=2"');
  });
  it('matches the server on editor output', () => {
    const html = '<h2>T</h2><p>a<br>b <strong>c</strong> <code>d</code></p><ul><li>e</li></ul><hr><pre><code>f &lt;g&gt;</code></pre><blockquote><p>h</p></blockquote>';
    expect(cleanRichHtml(html)).toBe(sanitizeRich(html));
  });
  it('takes a tag list', () => {
    expect(cleanRichHtml('<h2>T</h2><p>x</p>', { tags: NOTE_TAGS })).toBe('T<p>x</p>');
  });
  it('treats comments and blanks as nothing', () => {
    expect(cleanRichHtml('<!-- x --><p>a</p>')).toBe('<p>a</p>');
    expect(cleanRichHtml('')).toBe('');
    expect(cleanRichHtml(null)).toBe('');
    expect(cleanRichNodes(undefined).childNodes.length).toBe(0);
  });
  it('is exported from the lite entry', () => {
    expect(lite.cleanRichHtml).toBe(cleanRichHtml);
    expect(lite.installRichTrustedTypes).toBe(installRichTrustedTypes);
  });
});

describe('safeHref', () => {
  it('allows relative and safe schemes, refuses the rest', () => {
    expect(safeHref('https://x.com')).toBe('https://x.com');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('#top')).toBe('#top');
    expect(safeHref('vbscript:x')).toBe(null);
    expect(safeHref('\u0001javascript:x')).toBe(null);
    expect(safeHref('')).toBe(null);
  });
});

describe('RichText clean', () => {
  it('builds cleaned nodes instead of injecting the HTML', () => {
    const { container } = render(<RichText clean html={'<p>Hi<img src=x onerror="window.__x=1"><a href="javascript:1">l</a></p>'} />);
    const view = container.querySelector('.mk-rte-view');
    expect(view.innerHTML).toBe('<p>Hi<a rel="noopener noreferrer" target="_blank">l</a></p>');
  });
  it('escapes plain text and keeps its line breaks', () => {
    const { container } = render(<RichText clean html={'a <script>\nb'} />);
    expect(container.querySelector('.mk-rte-view').innerHTML).toBe('<p>a &lt;script&gt;<br>b</p>');
  });
  it('updates when the value changes and takes a tag list', () => {
    const { container, rerender } = render(<RichText clean={['p']} html="<h2>a</h2>" />);
    expect(container.querySelector('.mk-rte-view').innerHTML).toBe('a');
    rerender(<RichText clean={['p']} html="<p>b</p>" />);
    expect(container.querySelector('.mk-rte-view').innerHTML).toBe('<p>b</p>');
  });
  it('refills the new element when `as` changes', () => {
    const { container, rerender } = render(<RichText clean html="<p>x</p>" />);
    rerender(<RichText clean as="section" html="<p>x</p>" />);
    expect(container.querySelector('section.mk-rte-view').innerHTML).toBe('<p>x</p>');
  });
  it('matches the server on links and attributes', () => {
    const html = '<p><a href="https://a.com/x?y=1" title="t" class="c">a</a> <a href="mailto:a@b.c">m</a> <a href="javascript:1">j</a> <span style="x">s</span></p>';
    expect(cleanRichHtml(html)).toBe(sanitizeRich(html));
  });
  it('without clean renders as before', () => {
    const { container } = render(<RichText html="<p><span>x</span></p>" />);
    expect(container.querySelector('.mk-rte-view').innerHTML).toBe('<p><span>x</span></p>');
  });
});

describe('installRichTrustedTypes', () => {
  afterEach(() => { delete window.trustedTypes; });
  it('returns null where Trusted Types is missing', () => {
    expect(installRichTrustedTypes()).toBe(null);
  });
  it('creates a default policy that cleans HTML and checks script URLs', () => {
    const made = {};
    window.trustedTypes = { defaultPolicy: null, createPolicy: vi.fn((name, rules) => { made[name] = rules; return { name, ...rules }; }) };
    const p = installRichTrustedTypes();
    expect(p.name).toBe('default');
    expect(made.default.createHTML('<p onclick="x">a<script>b</script></p>')).toBe('<p>a</p>');
    expect(made.default.createScriptURL('/assets/x.js')).toBe('/assets/x.js');
    expect(made.default.createScriptURL(GOOGLE_GSI_URL)).toBe(GOOGLE_GSI_URL);
    expect(() => made.default.createScriptURL('https://evil.example/x.js')).toThrow(/Blocked/);
    expect(made.default.createScript).toBeUndefined();
  });
  it('keeps an existing default policy', () => {
    const existing = { name: 'default' };
    window.trustedTypes = { defaultPolicy: existing, createPolicy: vi.fn() };
    expect(installRichTrustedTypes()).toBe(existing);
    expect(window.trustedTypes.createPolicy).not.toHaveBeenCalled();
  });
});
