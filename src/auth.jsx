import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Button } from './Button.jsx';
import { Input, Field } from './Inputs.jsx';
import { Banner } from './States.jsx';

/*
 * Front end for @mn/kit/server's createAuth router.
 *
 *   <SessionProvider apiBase="/api/auth">
 *     <AuthGate login={{ appName: 'NextGen', logo: '/logo.svg' }}>
 *       <App />            // only rendered when signed in
 *     </AuthGate>
 *   </SessionProvider>
 *
 *   const { user, signOut } = useSession();
 */

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const SessionCtx = createContext(null);

export function SessionProvider({ apiBase = '/api/auth', children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/me`, { credentials: 'same-origin' });
      setUser(res.ok ? (await res.json()).user : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { refresh(); }, [refresh]);

  const signOut = useCallback(async () => {
    try { await post(`${apiBase}/logout`); } finally { setUser(null); }
  }, [apiBase]);

  return (
    <SessionCtx.Provider value={{ user, loading, apiBase, setUser, refresh, signOut }}>
      {children}
    </SessionCtx.Provider>
  );
}

/** { user, loading, refresh, signOut, setUser, apiBase }. user is null when signed out. */
export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('useSession must be used inside <SessionProvider>');
  return c;
}

/** Renders children when signed in, the LoginPage when not, nothing while checking. */
export function AuthGate({ children, login = {}, loading: loadingView = null }) {
  const { user, loading } = useSession();
  if (loading) return loadingView;
  if (!user) return <LoginPage {...login} />;
  return children;
}

let gsiPromise;
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  gsiPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => { gsiPromise = null; reject(new Error('Couldn’t load Google sign-in')); };
    document.head.appendChild(s);
  });
  return gsiPromise;
}

function GoogleButton({ clientId, onCredential }) {
  const el = useRef(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadGoogle().then((google) => {
      if (!live || !el.current) return;
      google.accounts.id.initialize({ client_id: clientId, callback: (r) => cb.current(r.credential) });
      google.accounts.id.renderButton(el.current, {
        theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
        size: 'large', text: 'continue_with', shape: 'rectangular', width: Math.min(el.current.offsetWidth || 320, 400),
      });
    }).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [clientId]);
  if (failed) return null;
  return <div ref={el} className="mk-auth-google" />;
}

/**
 * Sign-in screen: password, Google, and emailed code, showing whichever the
 * server has turned on (GET {apiBase}/config).
 *   <LoginPage appName="NextGen" logo="/logo.svg" subtitle="Staff sign-in" />
 * Inside a SessionProvider it signs the app in by itself; otherwise pass onSignedIn(user).
 */
export function LoginPage({ appName, logo, subtitle, apiBase: apiProp, onSignedIn, footer }) {
  const session = useContext(SessionCtx);
  const apiBase = apiProp || session?.apiBase || '/api/auth';
  const [config, setConfig] = useState(null);
  const [step, setStep] = useState('start'); // start | code
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    fetch(`${apiBase}/config`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { password: true }))
      .then(setConfig)
      .catch(() => setConfig({ password: true }));
  }, [apiBase]);

  const done = (user) => {
    session?.setUser(user);
    onSignedIn?.(user);
  };

  const run = (what, fn) => async (e) => {
    e?.preventDefault?.();
    setBusy(what);
    setError(null);
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(null); }
  };

  const signInPassword = run('password', async () => {
    const { user } = await post(`${apiBase}/login`, { email, password });
    done(user);
  });

  const sendCode = run('send', async () => {
    if (!email.trim()) throw new Error('Enter your email first');
    await post(`${apiBase}/code`, { email });
    setCode('');
    setStep('code');
    setNotice(`If ${email.trim()} has an account, a 6-digit code is on its way.`);
  });

  const verifyCode = run('verify', async () => {
    const { user } = await post(`${apiBase}/code/verify`, { email, code });
    done(user);
  });

  const google = (credential) => run('google', async () => {
    const { user } = await post(`${apiBase}/google`, { credential });
    done(user);
  })();

  return (
    <div className="mk-auth">
      <div className="mk-auth-card">
        <div className="mk-auth-head">
          {logo && <img src={logo} alt="" className="mk-auth-logo" />}
          <h1 className="mk-auth-title">{step === 'code' ? 'Check your email' : `Sign in${appName ? ` to ${appName}` : ''}`}</h1>
          {step === 'start' && subtitle && <p className="mk-auth-sub">{subtitle}</p>}
          {step === 'code' && notice && <p className="mk-auth-sub">{notice}</p>}
        </div>

        {error && <Banner className="mk-auth-error">{error}</Banner>}

        {!config ? null : step === 'start' ? (
          <>
            {config.google && (
              <>
                <GoogleButton clientId={config.google} onCredential={google} />
                <div className="mk-auth-divider"><span>or</span></div>
              </>
            )}
            <form onSubmit={signInPassword} noValidate>
              <Field label="Email">
                <Input type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              {config.password !== false && (
                <Field label="Password">
                  <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
              )}
              <div className="mk-auth-actions">
                {config.password !== false && (
                  <Button type="submit" block loading={busy === 'password'} disabled={!email || !password || !!busy}>Sign in</Button>
                )}
                {config.code && (
                  <Button variant="secondary" block loading={busy === 'send'} disabled={!!busy} onClick={sendCode}>
                    Email me a sign-in code
                  </Button>
                )}
              </div>
              {config.code && config.password !== false && (
                <p className="mk-auth-hint">Forgot your password? Sign in with an emailed code, then set a new one.</p>
              )}
            </form>
          </>
        ) : (
          <form onSubmit={verifyCode} noValidate>
            <Field label="6-digit code">
              <Input
                className="mk-code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
              />
            </Field>
            <div className="mk-auth-actions">
              <Button type="submit" block loading={busy === 'verify'} disabled={code.length !== 6 || !!busy}>Sign in</Button>
              <div className="mk-auth-row">
                <Button variant="ghost" size="sm" onClick={() => { setStep('start'); setError(null); }}>Use a different email</Button>
                <Button variant="ghost" size="sm" disabled={!!busy} onClick={sendCode}>Send a new code</Button>
              </div>
            </div>
          </form>
        )}
        {footer && <div className="mk-auth-footer">{footer}</div>}
      </div>
    </div>
  );
}
