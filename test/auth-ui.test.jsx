import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SessionProvider, AuthGate, useSession } from '../src/index.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mockServer() {
  let user = null;
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push([url, body]);
    const json = (status, data) => ({ ok: status < 400, status, json: async () => data });
    if (url.endsWith('/me')) return user ? json(200, { user }) : json(401, { error: 'Not signed in' });
    if (url.endsWith('/config')) return json(200, { password: true, code: true, google: null });
    if (url.endsWith('/login')) {
      if (body.password !== 'pw123456') return json(401, { error: 'Wrong email or password' });
      user = { id: 1, email: body.email, role: 'user' };
      return json(200, { user });
    }
    if (url.endsWith('/code')) return json(200, { sent: true });
    if (url.endsWith('/code/verify')) { user = { id: 1, email: body.email }; return json(200, { user }); }
    if (url.endsWith('/logout')) { user = null; return json(200, { ok: true }); }
    return json(404, {});
  }));
  return calls;
}

function App() {
  const { user, signOut } = useSession();
  return <div><p>Hello {user.email}</p><button onClick={signOut}>Sign out</button></div>;
}

const ui = () => render(<SessionProvider><AuthGate login={{ appName: 'Test' }}><App /></AuthGate></SessionProvider>);

describe('LoginPage + AuthGate', () => {
  it('shows an error, then signs in with a password, then signs out', async () => {
    mockServer();
    ui();
    expect(await screen.findByRole('heading', { name: 'Sign in to Test' })).toBeTruthy();
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'ana@x.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Wrong email or password')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Hello ana@x.com')).toBeTruthy();
    fireEvent.click(screen.getByText('Sign out'));
    expect(await screen.findByRole('heading', { name: 'Sign in to Test' })).toBeTruthy();
  });

  it('email code flow', async () => {
    const calls = mockServer();
    ui();
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'ben@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in code' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy();
    const input = screen.getByLabelText('6-digit code');
    fireEvent.change(input, { target: { value: '12a34 56' } });
    expect(input.value).toBe('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Hello ben@x.com')).toBeTruthy();
    await waitFor(() => expect(calls.some(([u, b]) => u.endsWith('/code/verify') && b.code === '123456')).toBe(true));
  });
});
