'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const ERROR_COPY: Record<string, string> = {
  auth: 'Sign-in failed. Try again.',
  not_allowed: 'This Google account is not on the invite list.',
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const next = searchParams.get('next') || '/';
  const queryError = searchParams.get('error');

  useEffect(() => {
    if (queryError) {
      setError(ERROR_COPY[queryError] ?? 'Sign-in failed.');
    }
  }, [queryError]);

  useEffect(() => {
    fetch('/api/auth/config')
      .then(r => r.json())
      .then((cfg: { passwordLogin?: boolean }) => setShowPassword(!!cfg.passwordLogin))
      .catch(() => setShowPassword(false));
  }, []);

  async function signInWithGoogle() {
    setGoogleLoading(true);
    setError('');

    try {
      const supabase = createSupabaseBrowserClient();
      const origin =
        process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || window.location.origin;
      const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (oauthError) setError(oauthError.message);
    } catch {
      setError('Network error — try again');
    } finally {
      setGoogleLoading(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.replace(next);
      } else {
        setError('Incorrect password');
        setPassword('');
        inputRef.current?.focus();
      }
    } catch {
      setError('Network error — try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-serif font-bold tracking-tight text-fg">Earnings Edge</h1>
          <p className="text-sm text-fg-dim">Sign in to continue</p>
        </div>

        <div className="space-y-4">
          <button
            type="button"
            disabled={googleLoading}
            onClick={() => void signInWithGoogle()}
            className="w-full py-3 text-xs tracking-[0.15em] border border-border bg-bg-elevated text-fg hover:border-fg-subtle disabled:opacity-40 transition-colors touch-target flex items-center justify-center gap-2"
          >
            {googleLoading ? 'REDIRECTING…' : 'CONTINUE WITH GOOGLE'}
          </button>

          {showPassword ? (
            <>
              <div className="flex items-center gap-3 text-[10px] text-fg-dim tracking-widest">
                <span className="h-px flex-1 bg-border-subtle" />
                OR PASSPHRASE
                <span className="h-px flex-1 bg-border-subtle" />
              </div>
              <form onSubmit={submitPassword} className="space-y-3">
                <div className="relative">
                  <input
                    ref={inputRef}
                    type={visible ? 'text' : 'password'}
                    value={password}
                    onChange={e => {
                      setPassword(e.target.value);
                      setError('');
                    }}
                    placeholder="passphrase"
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full bg-bg-elevated border border-border text-fg text-sm px-4 py-3 pr-12 tracking-widest placeholder:text-fg-dim placeholder:tracking-normal focus:outline-none focus:border-fg-subtle transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setVisible(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-dim hover:text-fg text-[10px] tracking-widest transition-colors select-none"
                    tabIndex={-1}
                  >
                    {visible ? 'HIDE' : 'SHOW'}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={loading || !password}
                  className="w-full py-3 text-xs tracking-[0.2em] border border-fg-subtle text-fg hover:bg-bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'CHECKING…' : 'ENTER'}
                </button>
              </form>
            </>
          ) : null}
        </div>

        {error ? (
          <p className="text-xs text-signal-sell tracking-wide text-center" role="alert">
            {error}
          </p>
        ) : null}

        <p className="text-center text-[10px] text-fg-dim tracking-widest">
          SIGN IN WITH YOUR GOOGLE ACCOUNT
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
