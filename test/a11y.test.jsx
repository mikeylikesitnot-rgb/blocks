// Accessibility fixes from the Web Interface Guidelines audit (v0.27.0).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useState } from 'react';
import {
  Modal, FilterMenu, ColumnOrder, Tabs, OverlayProvider, useToast, DataTable, SidebarLayout,
} from '../src/index.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Esc in a dropdown inside a Modal', () => {
  function Harness({ children }) {
    const [open, setOpen] = useState(true);
    return <Modal open={open} onClose={() => setOpen(false)} title="Edit">{children}</Modal>;
  }

  it('FilterMenu: Esc closes the menu, not the modal', () => {
    render(<Harness><FilterMenu label="Status" options={[{ value: 'a', label: 'A' }]} value={[]} onChange={() => {}} /></Harness>);
    const btn = screen.getByRole('button', { name: /Status/ });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document.activeElement || document, { key: 'Escape' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('dialog', { name: 'Edit' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' }); // menu closed: now Esc closes the modal
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ColumnOrder: Esc closes the menu, not the modal', () => {
    render(<Harness><ColumnOrder columns={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} order={['a', 'b']} onChange={() => {}} /></Harness>);
    const btn = screen.getAllByRole('button').find((b) => b.hasAttribute('aria-expanded'));
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('Modal', () => {
  it('is named by its title, even when the title is not a string', () => {
    render(<Modal open onClose={() => {}} title={<span>Edit <b>car</b></span>}>x</Modal>);
    expect(screen.getByRole('dialog', { name: 'Edit car' })).toBeTruthy();
  });

  it('stacked modals closed in any order leave the page scrollable', () => {
    document.body.style.overflow = 'auto';
    function Two() {
      const [a, setA] = useState(true);
      const [b, setB] = useState(true);
      return (
        <>
          <Modal open={a} onClose={() => setA(false)} title="A">a<button onClick={() => setA(false)}>close A</button></Modal>
          <Modal open={b} onClose={() => setB(false)} title="B">b<button onClick={() => setB(false)}>close B</button></Modal>
        </>
      );
    }
    render(<Two />);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByText('close A')); // the one underneath closes first
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByText('close B'));
    expect(document.body.style.overflow).toBe('auto');
  });
});

describe('Tabs', () => {
  function Harness() {
    const [tab, setTab] = useState('b');
    return <Tabs label="Views" value={tab} onChange={setTab} items={[{ value: 'a', label: 'All' }, { value: 'b', label: 'Open' }, { value: 'c', label: 'Done' }]} />;
  }
  it('has one Tab stop and moves with arrows, Home and End', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    tabs[1].focus();
    fireEvent.keyDown(tabs[1], { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Done');
    expect(document.activeElement.textContent).toBe('Done');
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' }); // wraps
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('All');
    fireEvent.keyDown(document.activeElement, { key: 'End' });
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Done');
    fireEvent.keyDown(document.activeElement, { key: 'Home' });
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('All');
  });
});

describe('Toasts', () => {
  function Harness() {
    const toast = useToast();
    return <button onClick={() => toast('Saved!')}>go</button>;
  }
  it('close with ×, pause while hovered, and sit in one live region with no role of their own', () => {
    vi.useFakeTimers();
    render(<OverlayProvider><Harness /></OverlayProvider>);
    fireEvent.click(screen.getByText('go'));
    const toast = screen.getByText('Saved!').closest('.mk-toast');
    expect(toast.getAttribute('role')).toBeNull();
    expect(toast.closest('[aria-live="polite"]')).toBeTruthy();

    fireEvent.mouseEnter(toast);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(screen.queryByText('Saved!')).toBeTruthy(); // paused
    fireEvent.mouseLeave(toast);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByText('Saved!')).toBeNull();

    fireEvent.click(screen.getByText('go'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Saved!')).toBeNull();
  });
});

describe('DataTable clickable rows', () => {
  it('open with Space as well as Enter', () => {
    const open = vi.fn();
    render(<DataTable columns={[{ key: 'name', label: 'Name' }]} data={[{ id: 1, name: 'Ana' }]} rowKey={(r) => r.id} onRowClick={open} />);
    const row = screen.getAllByText('Ana')[0].closest('[tabindex="0"]');
    fireEvent.keyDown(row, { key: ' ' });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe('SidebarLayout skip link', () => {
  it('comes first and moves focus to the page', () => {
    render(<SidebarLayout sidebar={<a href="#x">Nav</a>}><p>Page</p></SidebarLayout>);
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    fireEvent.click(skip);
    expect(document.activeElement.tagName).toBe('MAIN');
  });
  it('can be turned off', () => {
    render(<SidebarLayout skipLabel={null} sidebar={null}><p>Page</p></SidebarLayout>);
    expect(screen.queryByRole('link', { name: 'Skip to content' })).toBeNull();
  });
});
