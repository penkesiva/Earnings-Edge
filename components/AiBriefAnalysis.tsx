'use client';

import { useState } from 'react';

type BriefPayload = Record<string, unknown>;

type State = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

export function AiBriefAnalysis({ brief }: { brief: BriefPayload }) {
  const [state, setState]   = useState<State>('idle');
  const [text, setText]     = useState('');
  const [error, setError]   = useState('');

  async function runAnalysis() {
    setState('loading');
    setText('');
    setError('');

    try {
      const res = await fetch('/api/internal/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(brief),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `HTTP ${res.status}`);
        setState('error');
        return;
      }

      if (!res.body) {
        setError('No response body');
        setState('error');
        return;
      }

      setState('streaming');
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // OpenAI SSE lines look like: "data: {...}\n\n"
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';  // keep incomplete last line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') break;
          try {
            const json    = JSON.parse(payload);
            const delta   = json.choices?.[0]?.delta?.content as string | undefined;
            if (delta) setText(prev => prev + delta);
          } catch {
            // Partial JSON chunk — ignore
          }
        }
      }

      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setState('error');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (state === 'idle') {
    return (
      <div className="mt-4 pt-3 border-t border-border-subtle">
        <button
          type="button"
          onClick={runAnalysis}
          className="text-xs px-3 py-1.5 border border-violet-500/40 text-violet-400 hover:border-violet-400 hover:text-violet-300 tracking-widest transition-colors"
        >
          ✦ ANALYZE WITH GPT-5.5
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-3 border-t border-violet-500/30">
      {/* Section header */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[10px] tracking-widest text-violet-400/70 uppercase">
          GPT-5.5 ANALYSIS
        </span>
        {(state === 'loading' || state === 'streaming') && (
          <span className="text-[10px] text-violet-400 animate-pulse">● THINKING…</span>
        )}
        {state === 'done' && (
          <button
            type="button"
            onClick={runAnalysis}
            className="text-[10px] text-fg-dim hover:text-fg tracking-widest transition-colors"
          >
            ↻ RE-RUN
          </button>
        )}
      </div>

      {state === 'error' && (
        <p className="text-xs text-signal-sell">{error}</p>
      )}

      {(state === 'streaming' || state === 'done') && text && (
        <div className="text-xs text-fg-muted leading-relaxed whitespace-pre-wrap font-mono border border-violet-500/20 bg-violet-500/5 px-4 py-3">
          {text}
          {state === 'streaming' && (
            <span className="inline-block w-1.5 h-3 bg-violet-400 animate-pulse ml-0.5 align-middle" />
          )}
        </div>
      )}

      {state === 'loading' && (
        <div className="text-xs text-violet-400/50 animate-pulse">
          Assembling brief data…
        </div>
      )}
    </div>
  );
}
