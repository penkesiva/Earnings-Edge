'use client';

import { useState } from 'react';
import type { NarrativeOverhang } from '@/lib/screamTest';

export type AiBriefPayload = {
  ticker: string;
  earnings_date: string;
  composite_score: number;
  beat_streak_score: number | null;
  surprise_magnitude_score: number | null;
  revision_trend_score: number | null;
  whisper_delta_score: number | null;
  iv_rank_score: number | null;
  sector_momentum_score: number | null;
  insider_score: number | null;
  iv_rank: number | null;
  iv_30d: number | null;
  expected_move_dollar: number | null;
  expected_move_pct: number | null;
  put_call_ratio: number | null;
  scream_direction: string | null;
  scream_score: number | null;
  scream_qualifies: boolean | string | null;
  scream_notes: string | string[] | null;
  final_action: string | null;
  final_action_rationale: string | null;
  overhangs: NarrativeOverhang[];
};

type State = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

type Provider = 'openai' | 'gemini';

interface ProviderConfig {
  label: string;
  buttonLabel: string;
  endpoint: string;
  // Parses a single SSE data payload into a text chunk (or null to skip)
  parseChunk: (payload: string) => string | null;
  colorClass: {
    border: string;
    borderSubtle: string;
    text: string;
    textDim: string;
    bg: string;
    pulse: string;
    cursor: string;
  };
}

const CONFIGS: Record<Provider, ProviderConfig> = {
  openai: {
    label: 'GPT-5.5 ANALYSIS',
    buttonLabel: '✦ ANALYZE WITH GPT-5.5',
    endpoint: '/api/internal/ai-analysis',
    parseChunk(payload) {
      if (payload === '[DONE]') return null;
      try {
        const json = JSON.parse(payload);
        return (json.choices?.[0]?.delta?.content as string | undefined) ?? null;
      } catch {
        return null;
      }
    },
    colorClass: {
      border:      'border-violet-500/40',
      borderSubtle:'border-violet-500/30',
      text:        'text-violet-400',
      textDim:     'text-violet-400/70',
      bg:          'bg-violet-500/5',
      pulse:       'bg-violet-400',
      cursor:      'border-violet-400 text-violet-300',
    },
  },
  gemini: {
    label: 'GEMINI 3.1 PRO ANALYSIS',
    buttonLabel: '✦ ANALYZE WITH GEMINI',
    endpoint: '/api/internal/gemini-analysis',
    parseChunk(payload) {
      try {
        const json = JSON.parse(payload);
        // Gemini streaming format: candidates[0].content.parts[0].text
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;
        return text ?? null;
      } catch {
        return null;
      }
    },
    colorClass: {
      border:      'border-blue-500/40',
      borderSubtle:'border-blue-500/30',
      text:        'text-blue-400',
      textDim:     'text-blue-400/70',
      bg:          'bg-blue-500/5',
      pulse:       'bg-blue-400',
      cursor:      'border-blue-400 text-blue-300',
    },
  },
};

function AnalysisPanel({
  provider,
  brief,
}: {
  provider: Provider;
  brief: AiBriefPayload;
}) {
  const [state, setState] = useState<State>('idle');
  const [text, setText]   = useState('');
  const [error, setError] = useState('');

  const cfg = CONFIGS[provider];
  const c   = cfg.colorClass;

  async function run() {
    setState('loading');
    setText('');
    setError('');

    try {
      const res = await fetch(cfg.endpoint, {
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
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          const chunk = cfg.parseChunk(payload);
          if (chunk) setText(prev => prev + chunk);
        }
      }

      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setState('error');
    }
  }

  return (
    <div>
      {/* Header row: label + status when active, button when idle */}
      {state === 'idle' ? (
        <button
          type="button"
          onClick={run}
          className={`text-xs px-3 py-1.5 border ${c.border} ${c.text} hover:border-opacity-80 hover:opacity-90 tracking-widest transition-colors`}
        >
          {cfg.buttonLabel}
        </button>
      ) : (
        <div className={`pt-3 border-t ${c.borderSubtle}`}>
          <div className="flex items-center gap-3 mb-3">
            <span className={`text-[10px] tracking-widest ${c.textDim} uppercase`}>
              {cfg.label}
            </span>
            {(state === 'loading' || state === 'streaming') && (
              <span className={`text-[10px] ${c.text} animate-pulse`}>● THINKING…</span>
            )}
            {state === 'done' && (
              <button
                type="button"
                onClick={run}
                className="text-[10px] text-fg-dim hover:text-fg tracking-widest transition-colors"
              >
                ↻ RE-RUN
              </button>
            )}
          </div>

          {state === 'error' && (
            <p className="text-xs text-signal-sell">{error}</p>
          )}

          {state === 'loading' && (
            <div className={`text-xs ${c.textDim} animate-pulse tracking-widest`}>
              Assembling brief data…
            </div>
          )}

          {(state === 'streaming' || state === 'done') && text && (
            <div className={`text-xs text-fg-muted leading-relaxed whitespace-pre-wrap font-mono border ${c.borderSubtle} ${c.bg} px-4 py-3`}>
              {text}
              {state === 'streaming' && (
                <span className={`inline-block w-1.5 h-3 ${c.pulse} animate-pulse ml-0.5 align-middle`} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AiBriefAnalysis({ brief }: { brief: AiBriefPayload }) {
  return (
    <div className="mt-4 pt-3 border-t border-border-subtle space-y-4">
      <AnalysisPanel provider="openai" brief={brief} />
      <AnalysisPanel provider="gemini" brief={brief} />
    </div>
  );
}
