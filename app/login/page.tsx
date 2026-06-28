'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const ERROR_COPY: Record<string, string> = {
  auth: 'Sign-in failed. Try again.',
  not_allowed: 'This Google account is not on the invite list.',
};

function LoginForm() {
  const searchParams = useSearchParams();

  const [error, setError] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);

  const next = searchParams.get('next') || '/';
  const queryError = searchParams.get('error');

  useEffect(() => {
    if (queryError) {
      setError(ERROR_COPY[queryError] ?? 'Sign-in failed.');
    }
  }, [queryError]);

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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-serif font-bold tracking-tight text-fg">Earnings Edge</h1>
          <p className="text-sm text-fg-dim">Sign in to continue</p>
        </div>

        <button
          type="button"
          disabled={googleLoading}
          onClick={() => void signInWithGoogle()}
          className="w-full py-3 text-xs tracking-[0.15em] border border-border bg-bg-elevated text-fg hover:border-fg-subtle disabled:opacity-40 transition-colors touch-target flex items-center justify-center gap-2"
        >
          {googleLoading ? 'REDIRECTING…' : 'CONTINUE WITH GOOGLE'}
        </button>

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
