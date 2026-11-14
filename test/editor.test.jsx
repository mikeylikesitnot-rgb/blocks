import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
// The two apps' own configs, rebuilt here to prove the kit's output matches them.
// Both packages ship inside @tiptap/starter-kit v3, which is why the kit needs neither.
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import {
  RichTextEditor, RichText, editorExtensions, DEFAULT_TOOLBAR,
  isBlankHtml, sameHtml, htmlToText, toRichHtml,
} from '../src/editor/index.js';

afterEach(cleanup);

// AutoDealer src/components/RichTextEditor.jsx (contract notes).
const AUTODEALER_DISABLE = ['heading', 'codeBlock', 'horizontalRule'];
const autoDealerLegacy = () => [StarterKit.configure({
  heading: false, codeBlock: false, horizontalRule: false,
  link: {
    openOnClick: false, autolink: true, defaultProtocol: 'https',
    protocols: ['http', 'https', 'mailto', 'tel'],
    HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
  },
})];
// TuroApp client/src/components/RichTextEditor.jsx (car and guest notes).
const turoLegacy = () => [
  StarterKit, Underline,
  Link.configure({ openOnClick: false, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } }),
];

function roundTrip(extensions, html) {
  const editor = new Editor({ extensions, content: html });
  const out = editor.getHTML();
  editor.destroy();
  return out;
}

const A = '<a target="_blank" rel="noopener noreferrer" href="https://example.com/a?b=1&amp;c=2">a link</a>';

// HTML each app saves today, in the exact form its editor emits it.
const AUTODEALER_SAMPLES = [
  '<p>Called the buyer, <strong>pays Friday</strong>.</p>',
  '<p><strong>Bold</strong> <em>italic</em> <u>underline</u> <s>struck</s> <code>VIN123</code></p>',
  '<p><strong><em>both</em></strong> and <strong><u>mixed</u></strong></p>',
  '<p>line one<br>line two</p><p>second paragraph</p>',
  '<ul><li><p>first</p></li><li><p>second</p></li></ul>',
  '<ol><li><p>one</p></li><li><p>two</p><ul><li><p>nested</p></li></ul></li></ol>',
  '<blockquote><p>quoted text</p></blockquote>',
  `<p>See ${A} for terms.</p>`,
  '<p><a target="_blank" rel="noopener noreferrer" href="mailto:ana@example.com">ana@example.com</a> or <a target="_blank" rel="noopener noreferrer" href="tel:+12145550100">call</a></p>',
  '<p>Tom &amp; Jerry &lt;3 &gt; 2 and "quotes"</p>',
];
const TURO_SAMPLES = [
  ...AUTODEALER_SAMPLES,
  '<h1>Title</h1><h2>Section</h2><h3>Sub</h3><p>body</p>',
  '<pre><code>oil: 5W-30\ntires: 35 psi</code></pre>',
  '<pre><code class="language-js">const a = 1;</code></pre>',
  '<p>above</p><hr><p>below</p>',
  '<blockquote><p>Guest said:</p><ul><li><p>late return</p></li></ul></blockquote>',
  // Older links saved with Tiptap's default rel keep it on a re-save.
  '<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://turo.com/trip/1">trip</a></p>',
];

describe('HTML compatibility with the apps\' saved notes', () => {
  it.each(AUTODEALER_SAMPLES)('AutoDealer: %s round-trips unchanged', (html) => {
    expect(roundTrip(autoDealerLegacy(), html)).toBe(html); // sanity: this is what AutoDealer saves
    expect(roundTrip(editorExtensions({ disable: AUTODEALER_DISABLE }), html)).toBe(html);
    expect(roundTrip(editorExtensions(), html)).toBe(html);
  });

  it.each(TURO_SAMPLES)('TuroApp: %s round-trips unchanged', (html) => {
    expect(roundTrip(turoLegacy(), html)).toBe(html);
    expect(roundTrip(editorExtensions(), html)).toBe(html);
  });

  it.each([
    '<ul><li>bare item</li></ul>',
    '<p>a<br />b</p>', // sanitize-html writes <br />
    '<p><a href="https://x.com">no attrs</a></p>',
    '<p></p>',
    '<p><u><strong>marks in another order</strong></u></p>',
    '<h2>heading</h2><pre><code>x</code></pre><hr />',
  ])('normalizes %s exactly as each app does today', (html) => {
    expect(roundTrip(editorExtensions(), html)).toBe(roundTrip(turoLegacy(), html));
    expect(roundTrip(editorExtensions({ disable: AUTODEALER_DISABLE }), html)).toBe(roundTrip(autoDealerLegacy(), html));
  });

  it('creates links with the same attributes both apps saved', () => {
    for (const ext of [editorExtensions(), turoLegacy(), autoDealerLegacy()]) {
      const editor = new Editor({ extensions: ext, content: '<p>x</p>' });
      editor.chain().selectAll().setLink({ href: 'https://y.com' }).run();
      expect(editor.getHTML()).toBe('<p><a target="_blank" rel="noopener noreferrer" href="https://y.com">x</a></p>');
      editor.destroy();
    }
  });

  it('refuses javascript: links like both apps', () => {
    const out = roundTrip(editorExtensions(), '<p><a href="javascript:alert(1)">x</a></p>');
    expect(out).not.toContain('javascript');
  });
});

describe('RichTextEditor', () => {
  const input = () => document.querySelector('.mk-rte-input');

  it('renders the stored HTML without calling onChange', () => {
    const onChange = vi.fn();
    render(<RichTextEditor value={TURO_SAMPLES[1]} onChange={onChange} ariaLabel="Notes" />);
    expect(screen.getByRole('textbox', { name: 'Notes' }).innerHTML).toContain('<strong>Bold</strong>');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts TuroApp\'s prop names (content / onUpdate)', () => {
    const onUpdate = vi.fn();
    render(<RichTextEditor content="<p>hello</p>" onUpdate={onUpdate} />);
    expect(input().textContent).toBe('hello');
  });

  it('shows the default toolbar', () => {
    render(<RichTextEditor value="" onChange={() => {}} />);
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Undo', 'Redo', 'Bold', 'Italic', 'Underline', 'Strikethrough', 'Link',
      'Bulleted list', 'Numbered list', 'Quote', 'Code block']);
    expect(DEFAULT_TOOLBAR.filter((k) => k !== '|')).toHaveLength(labels.length);
  });

  it('drops buttons for disabled extensions and collapses separators', () => {
    render(<RichTextEditor value="" onChange={() => {}} disable={AUTODEALER_DISABLE}
      toolbar={['bold', 'italic', 'underline', '|', 'bulletList', 'orderedList', '|', 'link', '|', 'codeBlock']} />);
    expect(screen.queryByRole('button', { name: 'Code block' })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(6);
    expect(document.querySelectorAll('.mk-rte-sep')).toHaveLength(2);
  });

  // Tiptap stores the editor instance on its DOM node.
  const tiptap = () => input().editor;

  it('formats from the toolbar and emits HTML', async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="<p>word</p>" onChange={onChange} />);
    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    act(() => { tiptap().commands.selectAll(); });
    act(() => { fireEvent.mouseDown(bold); }); // the toolbar acts on mousedown so the selection survives
    expect(onChange).toHaveBeenLastCalledWith('<p><strong>word</strong></p>');
    expect(bold.getAttribute('aria-pressed')).toBe('true');
  });

  it('emits "" when the editor is emptied', () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="<p>x</p>" onChange={onChange} />);
    act(() => { tiptap().chain().selectAll().deleteSelection().run(); });
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('follows value changes from outside without emitting', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<RichTextEditor value="<p>one</p>" onChange={onChange} />);
    rerender(<RichTextEditor value="<p>two</p>" onChange={onChange} />);
    await waitFor(() => expect(input().textContent).toBe('two'));
    rerender(<RichTextEditor value="" onChange={onChange} />);
    await waitFor(() => expect(input().textContent).toBe(''));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows legacy plain text with its line breaks', () => {
    render(<RichTextEditor value={'line 1\nline 2\n\npara <2>'} onChange={() => {}} />);
    expect(input().innerHTML).toBe('<p>line 1<br>line 2</p><p>para &lt;2&gt;</p>');
  });

  it('adds a link from the link form', async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="<p>x</p>" onChange={onChange} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Link' }));
    fireEvent.change(screen.getByLabelText('Text to display'), { target: { value: 'Docs' } });
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)[0]).toContain('<a target="_blank" rel="noopener noreferrer" href="https://example.com">Docs</a>');
  });

  it('rejects a javascript: link in the form', () => {
    render(<RichTextEditor value="<p>x</p>" onChange={() => {}} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Link' }));
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert').textContent).toMatch(/http, https, mailto or tel/);
  });

  it('disabled turns off editing and the toolbar', () => {
    render(<RichTextEditor value="<p>x</p>" onChange={() => {}} disabled />);
    expect(input().getAttribute('contenteditable')).toBe('false');
    expect(screen.getByRole('button', { name: 'Bold' }).disabled).toBe(true);
  });

  it('restores a saved height when storageKey is set', () => {
    localStorage.setItem('rte-test-h', '240');
    render(<RichTextEditor value="" onChange={() => {}} storageKey="rte-test-h" />);
    const body = document.querySelector('.mk-rte-body');
    expect(body.className).toContain('mk-rte-resizable');
    expect(body.style.height).toBe('240px');
    localStorage.removeItem('rte-test-h');
  });
});

describe('RichText', () => {
  it('renders stored HTML', () => {
    const { container } = render(<RichText html="<p><strong>hi</strong></p>" className="x" />);
    expect(container.innerHTML).toBe('<div class="mk-rte-view x"><p><strong>hi</strong></p></div>');
  });
  it('renders nothing for a blank value', () => {
    const { container } = render(<RichText html="<p>&nbsp;</p>" />);
    expect(container.innerHTML).toBe('');
  });
  it('keeps line breaks in legacy plain text', () => {
    const { container } = render(<RichText html={'a\nb'} />);
    expect(container.querySelector('p').innerHTML).toBe('a<br>b');
  });
});

describe('value helpers', () => {
  it('isBlankHtml / sameHtml', () => {
    expect(isBlankHtml('<p></p>')).toBe(true);
    expect(isBlankHtml('<p>&nbsp; </p>')).toBe(true);
    expect(isBlankHtml('<p>x</p>')).toBe(false);
    expect(sameHtml('', '<p></p>')).toBe(true);
    expect(sameHtml('<p>a</p>', '<p>b</p>')).toBe(false);
  });
  it('toRichHtml passes HTML through and escapes plain text', () => {
    expect(toRichHtml('<p>x</p>')).toBe('<p>x</p>');
    expect(toRichHtml('a & b')).toBe('<p>a &amp; b</p>');
    expect(toRichHtml(null)).toBe('');
  });
  it('htmlToText flattens', () => {
    expect(htmlToText('<h2>T</h2><p>a&amp;b<br>c</p><ul><li><p>d</p></li></ul>')).toBe('T a&b c d');
  });
});

describe('bundle boundaries', () => {
  const src = (p) => readFileSync(`${process.cwd()}/src/${p}`, 'utf8');
  it('the main entry never loads the editor', () => {
    expect(src('index.js')).not.toMatch(/editor|tiptap/i);
  });
  it('the lite entry has no static Tiptap import', () => {
    for (const f of ['editor/lite.js', 'editor/RichText.jsx', 'editor/RichTextField.jsx', 'editor/value.js']) {
      expect(src(f)).not.toMatch(/from ['"]@tiptap/);
    }
    expect(src('editor/RichTextField.jsx')).toMatch(/import\('\.\/RichTextEditor\.jsx'\)/);
  });
});
