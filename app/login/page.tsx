'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const inputRef     = useRef<HTMLInputElement>(null);

  const [password, setPassword] = useState('');
  const [visible,  setVisible]  = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  // Auto-focus on mount — works for desktop; mobile shows keyboard on tap
  useEffect(() => { inputRef.current?.focus(); }, []);

  async function submit(e: React.FormEvent) {
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
        const next = searchParams.get('next') || '/';
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

        {/* Wordmark */}
        <div className="text-center space-y-1">
          <div className="text-xs tracking-[0.3em] text-fg-subtle uppercase">
            EARNINGS EDGE
          </div>
          <div className="text-[10px] tracking-widest text-fg-dim">
            PRIVATE — ENTER PASSPHRASE
          </div>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="space-y-4">
          <div className="relative">
            <input
              ref={inputRef}
              type={visible ? 'text' : 'password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              placeholder="passphrase"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full bg-bg-elevated border border-border text-fg text-sm px-4 py-3 pr-12 tracking-widest placeholder:text-fg-dim placeholder:tracking-normal focus:outline-none focus:border-fg-subtle transition-colors"
            />
            {/* Show / hide toggle */}
            <button
              type="button"
              onClick={() => setVisible(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-dim hover:text-fg text-[10px] tracking-widest transition-colors select-none"
              tabIndex={-1}
            >
              {visible ? 'HIDE' : 'SHOW'}
            </button>
          </div>

          {error && (
            <p className="text-xs text-signal-sell tracking-widest text-center">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 text-xs tracking-[0.2em] border border-fg-subtle text-fg hover:bg-bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'CHECKING…' : 'ENTER'}
          </button>
        </form>

        <p className="text-center text-[10px] text-fg-dim tracking-widest">
          SESSION LASTS 30 DAYS
        </p>
      </div>
    </div>
  );
}

// useSearchParams requires Suspense in Next.js app router
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
