import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { pageTitle, usePageTitle, TITLE_STATUS } from '../src/index.js';

describe('pageTitle', () => {
  it('joins parts most-specific-first with the app last', () => {
    expect(pageTitle(['ImageViewer', 'Features'], { app: 'Hub' })).toBe('ImageViewer · Features · Hub');
  });
  it('skips blank parts and squashes whitespace', () => {
    expect(pageTitle([null, '  Cars  \n list ', '', false, undefined], { app: 'Admin' })).toBe('Cars list · Admin');
  });
  it('cuts long parts with an ellipsis', () => {
    const t = pageTitle(['IV-015 Fixed-ratio and exact-size selection for crops'], { max: 20 });
    expect(t).toBe('IV-015 Fixed-ratio…');
    expect(t.length).toBeLessThanOrEqual(20);
  });
  it('prefixes a status symbol', () => {
    expect(pageTitle('X', { status: 'busy' })).toBe(`${TITLE_STATUS.busy} X`);
    expect(pageTitle('X', { status: 'attention' })).toBe('⚠ X');
    expect(pageTitle('X', { status: '(3)' })).toBe('(3) X');
  });
  it('takes a single string', () => {
    expect(pageTitle('Home', { app: 'Turo' })).toBe('Home · Turo');
  });
});

function Page({ parts, opts }) { usePageTitle(parts, opts); return null; }

describe('usePageTitle', () => {
  beforeEach(() => { document.title = 'App'; });
  it('sets the title and restores it on unmount', () => {
    const { rerender, unmount } = render(<Page parts={['A']} opts={{ app: 'Hub' }} />);
    expect(document.title).toBe('A · Hub');
    rerender(<Page parts={['B']} opts={{ app: 'Hub', status: 'done' }} />);
    expect(document.title).toBe('✓ B · Hub');
    unmount();
    expect(document.title).toBe('App');
  });
  it('the deeper page wins', () => {
    render(<Page parts={['Outer']}><span /></Page>);
    render(<Page parts={['Inner']} />);
    expect(document.title).toBe('Inner');
  });
});
