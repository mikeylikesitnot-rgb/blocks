import { describe, it, expect, afterEach, vi } from 'vitest';
import { useRef } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FileDrop, AttachmentGrid, usePasteFiles, checkFiles, fileAccepted, formatBytes, nameClipboardFile, filesFromPaste } from '../src/index.js';

afterEach(cleanup);

const file = (name, type, size = 10) => new File([new Uint8Array(size)], name, { type });
const paste = (el, { files = [], text = '' }) => {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  ev.clipboardData = {
    items: files.map((f) => ({ kind: 'file', getAsFile: () => f })),
    files,
    getData: (t) => (t === 'text/plain' ? text : ''),
  };
  el.dispatchEvent(ev);
  return ev;
};

describe('helpers', () => {
  it('formatBytes', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(820_000)).toBe('820 KB');
    expect(formatBytes(1_400_000)).toBe('1.4 MB');
    expect(formatBytes(20_000_000)).toBe('20 MB');
  });
  it('fileAccepted handles wildcards, exact types and extensions', () => {
    const accept = ['image/*', 'application/pdf', '.log'];
    expect(fileAccepted(file('a.png', 'image/png'), accept)).toBe(true);
    expect(fileAccepted(file('a.pdf', 'application/pdf'), accept)).toBe(true);
    expect(fileAccepted(file('server.LOG', ''), accept)).toBe(true);
    expect(fileAccepted(file('a.exe', 'application/x-msdownload'), accept)).toBe(false);
    expect(fileAccepted(file('a.exe', 'x'), [])).toBe(true);
  });
  it('checkFiles rejects by type and size with a reason', () => {
    const { ok, rejected } = checkFiles([file('a.png', 'image/png', 5), file('b.png', 'image/png', 50), file('c.exe', 'x')], { accept: ['image/*'], maxSize: 20 });
    expect(ok.map((f) => f.name)).toEqual(['a.png']);
    expect(rejected.map((r) => r.reason)).toEqual(['b.png is 50 B. The limit is 20 B.', "c.exe: this file type isn't allowed."]);
  });
  it('names a pasted screenshot by date', () => {
    const f = nameClipboardFile(file('image.png', 'image/png'), new Date(2026, 10, 15, 9, 5, 3));
    expect(f.name).toBe('Screenshot 2026-11-15 09.05.03.png');
    expect(nameClipboardFile(file('mine.png', 'image/png')).name).toBe('mine.png');
  });
});

describe('filesFromPaste', () => {
  const ev = (target, files, text) => ({ target, clipboardData: { items: files.map((f) => ({ kind: 'file', getAsFile: () => f })), getData: () => text } });
  it('takes an image pasted into a textarea when there is no text', () => {
    const ta = document.createElement('textarea');
    expect(filesFromPaste(ev(ta, [file('image.png', 'image/png')], ''))).toHaveLength(1);
  });
  it('keeps text when pasting into a field and the clipboard also has text (Word, Excel)', () => {
    const ta = document.createElement('textarea');
    expect(filesFromPaste(ev(ta, [file('image.png', 'image/png')], 'hello'))).toEqual([]);
  });
  it('takes the file outside a text field even with text', () => {
    const div = document.createElement('div');
    expect(filesFromPaste(ev(div, [file('image.png', 'image/png')], 'hello'))).toHaveLength(1);
  });
});

describe('usePasteFiles', () => {
  function Panel({ onFiles }) {
    const ref = useRef(null);
    usePasteFiles(ref, onFiles);
    return <div ref={ref}><textarea aria-label="Steps" /></div>;
  }
  it('pasting a screenshot while typing in a textarea attaches it and stops the default paste', () => {
    const onFiles = vi.fn();
    render(<Panel onFiles={onFiles} />);
    const ev = paste(screen.getByLabelText('Steps'), { files: [file('image.png', 'image/png')] });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0][0].name).toMatch(/^Screenshot .*\.png$/);
    expect(ev.defaultPrevented).toBe(true);
  });
  it('plain text paste is left alone', () => {
    const onFiles = vi.fn();
    render(<Panel onFiles={onFiles} />);
    const ev = paste(screen.getByLabelText('Steps'), { text: 'just text' });
    expect(onFiles).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe('FileDrop', () => {
  it('picks files and reports rejects', () => {
    const onFiles = vi.fn();
    const onReject = vi.fn();
    render(<FileDrop onFiles={onFiles} onReject={onReject} accept={['image/*']} maxSize={100} />);
    expect(screen.getByText(/up to 100 B each/)).toBeTruthy();
    fireEvent.change(screen.getByTestId('mk-file-input'), { target: { files: [file('a.png', 'image/png'), file('b.zip', 'application/zip')] } });
    expect(onFiles.mock.calls[0][0].map((f) => f.name)).toEqual(['a.png']);
    expect(onReject.mock.calls[0][0][0].file.name).toBe('b.zip');
  });
  it('drops files', () => {
    const onFiles = vi.fn();
    const { container } = render(<FileDrop onFiles={onFiles} />);
    const dataTransfer = { types: ['Files'], files: [file('a.pdf', 'application/pdf')] };
    fireEvent.dragEnter(container.firstChild, { dataTransfer });
    expect(container.firstChild.className).toContain('mk-drop-over');
    fireEvent.drop(container.firstChild, { dataTransfer });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(container.firstChild.className).not.toContain('mk-drop-over');
  });
});

describe('AttachmentGrid', () => {
  const items = [
    { id: 1, name: 'shot.png', mime: 'image/png', size: 1000, url: '/f/1' },
    { id: 2, name: 'server.log', mime: 'text/plain', size: 2_500_000, url: '/f/2' },
  ];
  it('shows images as thumbnails and files as download rows', () => {
    render(<AttachmentGrid items={items} />);
    expect(screen.getByRole('button', { name: 'Open shot.png' })).toBeTruthy();
    const link = screen.getByRole('link', { name: 'server.log' });
    expect(link.getAttribute('href')).toBe('/f/2');
    expect(link.hasAttribute('download')).toBe(true);
    expect(screen.getByText('2.5 MB')).toBeTruthy();
  });
  it('opens an image full size', () => {
    render(<AttachmentGrid items={items} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open shot.png' }));
    const dlg = screen.getByRole('dialog');
    expect(dlg.querySelector('img').getAttribute('src')).toBe('/f/1');
  });
  it('remove calls back with the item; none while pending', () => {
    const onRemove = vi.fn();
    render(<AttachmentGrid items={[...items, { id: 3, name: 'up.png', mime: 'image/png', size: 1, pending: true }]} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove server.log' }));
    expect(onRemove).toHaveBeenCalledWith(items[1]);
    expect(screen.queryByRole('button', { name: 'Remove up.png' })).toBeNull();
  });
  it('preview: false shows an image as a download row (HEIC outside Safari)', () => {
    render(<AttachmentGrid items={[{ id: 9, name: 'IMG_1.HEIC', mime: 'image/heic', size: 10, url: '/f/9', preview: false }]} />);
    expect(screen.queryByRole('button', { name: 'Open IMG_1.HEIC' })).toBeNull();
    expect(screen.getByRole('link', { name: 'IMG_1.HEIC' }).getAttribute('href')).toBe('/f/9');
  });
  it('renders nothing when empty', () => {
    const { container } = render(<AttachmentGrid items={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
