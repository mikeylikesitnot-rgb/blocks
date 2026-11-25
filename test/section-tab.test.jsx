import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { SectionTab, InfoIcon, FileIcon, InboxIcon } from '../src/index.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ITEMS = [
  { id: 's-a', label: 'Vehicle', icon: InfoIcon },
  { id: 's-b', label: 'Registration', icon: FileIcon, dot: 'amber', meta: 'due in 3 days' },
  { id: 's-c', label: 'Notes', icon: InboxIcon, meta: '2 lines' },
];

function Page(props) {
  return (
    <>
      {ITEMS.map((i) => <section key={i.id} id={i.id}>{i.label}</section>)}
      <SectionTab items={ITEMS} {...props} />
    </>
  );
}
const tab = () => screen.getByRole('button', { name: /^Sections/ });

describe('SectionTab', () => {
  it('names the current section and the dot on the tab', () => {
    render(<Page />);
    // jsdom has no layout, so which section counts as current is not tested here.
    expect(tab().getAttribute('aria-label')).toMatch(/^Sections, now \w+, Registration due soon$/);
    expect(tab().getAttribute('aria-expanded')).toBe('false');
    expect(tab().querySelector('.mk-sectab-dot-amber')).not.toBeNull();
  });

  it('opens a panel with full names and meta; picking one closes it and jumps', () => {
    const onJump = vi.fn();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0; });
    render(<Page onJump={onJump} />);
    fireEvent.click(tab());
    const dialog = screen.getByRole('dialog', { name: 'Sections' });
    expect(dialog.textContent).toContain('due in 3 days');
    expect(screen.queryByRole('button', { name: 'Reorder' })).toBeNull();      // no onReorder
    expect(screen.queryByRole('button', { name: 'Fold all' })).toBeNull();     // no onFoldAll
    fireEvent.click(within(dialog).getByRole('button', { name: /^Vehicle/ }));
    expect(onJump).toHaveBeenCalledWith('s-a');
    expect(scroll).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(tab().getAttribute('aria-label')).toMatch(/now Vehicle/);
  });

  it('closes on Escape and on the backdrop', () => {
    render(<Page />);
    fireEvent.click(tab());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(tab());
    fireEvent.click(screen.getByRole('button', { name: 'Close sections menu' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reorders with the arrows and folds all when the page passes handlers', () => {
    const onReorder = vi.fn();
    const onFoldAll = vi.fn();
    render(<Page onReorder={onReorder} onFoldAll={onFoldAll} />);
    fireEvent.click(tab());
    fireEvent.click(screen.getByRole('button', { name: 'Reorder' }));
    expect(screen.getByRole('button', { name: 'Move Vehicle up' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Move Vehicle down' }));
    expect(onReorder).toHaveBeenCalledWith(['s-b', 's-a', 's-c'], { persist: true });
    fireEvent.click(screen.getByRole('button', { name: 'Fold all' }));
    expect(onFoldAll).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders nothing without sections', () => {
    const { container } = render(<SectionTab items={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
