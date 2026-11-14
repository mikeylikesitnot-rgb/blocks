import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import {
  Button, Badge, toneFor, Field, Skeleton, Input, SearchInput, Modal, OverlayProvider, useConfirm, useToast,
  matchesQuery, StatCard, PlusIcon, XIcon,
} from '../src/index.js';

afterEach(cleanup);

describe('Button', () => {
  it('renders variant and size classes', () => {
    render(<Button variant="secondary" size="sm">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' }).className).toBe('mk-btn mk-btn-secondary mk-btn-sm');
  });
  it('falls back to primary for an unknown variant', () => {
    render(<Button variant="nope">X</Button>);
    expect(screen.getByRole('button').className).toContain('mk-btn-primary');
  });
  it('icon-only uses label as accessible name', () => {
    render(<Button icon={XIcon} label="Close" />);
    expect(screen.getByRole('button', { name: 'Close' }).className).toContain('mk-btn-icon');
  });
  it('loading disables and marks busy', () => {
    render(<Button loading icon={PlusIcon}>Save</Button>);
    const b = screen.getByRole('button');
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-busy')).toBe('true');
  });
  it('href renders a link', () => {
    render(<Button href="/x">Go</Button>);
    expect(screen.getByRole('link', { name: 'Go' }).getAttribute('href')).toBe('/x');
  });
});

describe('Badge', () => {
  it('guesses tone from status words, case-insensitive', () => {
    expect(toneFor('Overdue')).toBe('danger');
    expect(toneFor('completed')).toBe('success');
    expect(toneFor('Sold', { Sold: 'success' })).toBe('success');
    expect(toneFor('whatever')).toBe('neutral');
  });
  it('renders nothing for empty text', () => {
    const { container } = render(<Badge text="" />);
    expect(container.innerHTML).toBe('');
  });
  it('explicit tone wins', () => {
    render(<Badge tone="accent">Hi</Badge>);
    expect(screen.getByText('Hi').className).toContain('mk-tone-accent');
  });
});

describe('Field', () => {
  it('links label, input and error', () => {
    render(<Field label="Email" error="Bad email"><Input /></Field>);
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')).textContent).toBe('Bad email');
  });

  it('leaves a wrapper child alone so the label reaches the real input', () => {
    const { container } = render(
      <Field label="Price" htmlFor="price"><div className="row"><input id="price" /></div></Field>,
    );
    expect(container.querySelectorAll('#price')).toHaveLength(1);
    expect(screen.getByLabelText('Price').tagName).toBe('INPUT');
  });

  it('wires a plain native input too', () => {
    render(<Field label="Name" hint="Full name"><input /></Field>);
    expect(screen.getByLabelText('Name').getAttribute('aria-describedby')).toBeTruthy();
  });
});

describe('Skeleton', () => {
  it('has no inline height, so a size class can set it', () => {
    const { container } = render(<Skeleton className="tall" />);
    expect(container.firstChild.style.height).toBe('');
    const { container: c2 } = render(<Skeleton style={{ height: 40 }} />);
    expect(c2.firstChild.style.height).toBe('40px');
  });
});

describe('SearchInput', () => {
  it('clears on Escape and on the clear button', () => {
    let v = 'abc';
    const onChange = (x) => { v = x; };
    const { rerender } = render(<SearchInput value={v} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(v).toBe('');
    v = 'abc';
    rerender(<SearchInput value={v} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(v).toBe('');
  });
});

describe('StatCard', () => {
  it('colours delta by direction and invert', () => {
    render(<><StatCard label="Rev" value="1" delta={5} /><StatCard label="Cost" value="1" delta={5} invert /></>);
    const deltas = document.querySelectorAll('.mk-delta');
    expect(deltas[0].className).toContain('mk-delta-good');
    expect(deltas[1].className).toContain('mk-delta-bad');
  });
});

describe('Modal', () => {
  it('closes on Escape and renders nothing when closed', () => {
    let closed = false;
    const { rerender } = render(<Modal open title="Hi" onClose={() => { closed = true; }}>Body</Modal>);
    expect(screen.getByRole('dialog', { name: 'Hi' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closed).toBe(true);
    rerender(<Modal open={false} title="Hi" onClose={() => {}}>Body</Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('OverlayProvider', () => {
  function Harness({ onResult }) {
    const confirm = useConfirm();
    const toast = useToast();
    return (
      <>
        <button onClick={async () => onResult(await confirm({ title: 'Delete?', confirmLabel: 'Delete', danger: true }))}>ask</button>
        <button onClick={() => toast('Saved!')}>toast</button>
      </>
    );
  }
  it('confirm resolves true/false and toast shows', async () => {
    const results = [];
    render(<OverlayProvider><Harness onResult={(r) => results.push(r)} /></OverlayProvider>);
    fireEvent.click(screen.getByText('ask'));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Delete' })); });
    fireEvent.click(screen.getByText('ask'));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Cancel' })); });
    expect(results).toEqual([true, false]);
    fireEvent.click(screen.getByText('toast'));
    expect(await screen.findByText('Saved!')).toBeTruthy();
  });
});

describe('matchesQuery', () => {
  it('matches word prefixes and digits anywhere', () => {
    expect(matchesQuery('ana 2415', ['Ana Lopez', '(214) 555-2415'])).toBe(true);
    expect(matchesQuery('lop', ['Ana Lopez'])).toBe(true);
    expect(matchesQuery('ben', ['Ana Lopez'])).toBe(false);
    expect(matchesQuery('', [])).toBe(true);
  });
});
