'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { NarrativeOverhang } from '@/lib/screamTest';
import { ConsensusVerdict } from '@/components/ConsensusVerdict';

export type SavedAnalyses = Partial<
  Record<'openai' | 'gemini' | 'claude' | 'consensus', string>
>;

export type AiBriefPayload = {
  /** DB primary key — used to persist analysis results. */
  brief_id: string;
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
  /** Raw merged headlines (FMP + Gemini search) stored at scan time. */
  raw_headlines: { date: string; title: string; source: string }[] | null;
};

type PanelState = 'idle' | 'loading' | 'streaming' | 'done' | 'error';
type Provider   = 'openai' | 'gemini' | 'claude';

interface ProviderConfig {
  label: string;
  shortLabel: string;
  endpoint: string;
  parseChunk: (payload: string) => string | null;
  color: {
    border: string;
    text: string;
    textDim: string;
    bg: string;
    dotColor: string;
  };
}

const PROVIDERS: Provider[] = ['openai', 'gemini', 'claude'];

const CONFIGS: Record<Provider, ProviderConfig> = {
  openai: {
    label:      'GPT-5.5 ANALYSIS',
    shortLabel: 'GPT-5.5',
    endpoint:   '/api/internal/ai-analysis',
    parseChunk(payload) {
      if (payload === '[DONE]') return null;
      try {
        const json = JSON.parse(payload);
        return (json.choices?.[0]?.delta?.content as string | undefined) ?? null;
      } catch { return null; }
    },
    color: {
      border:   'border-violet-500/40',
      text:     'text-violet-400',
      textDim:  'text-violet-400/60',
      bg:       'bg-violet-500/5',
      dotColor: 'bg-violet-400',
    },
  },
  gemini: {
    label:      'GEMINI 3.1 PRO ANALYSIS',
    shortLabel: 'GEMINI',
    endpoint:   '/api/internal/gemini-analysis',
    parseChunk(payload) {
      try {
        const json = JSON.parse(payload);
        return (json.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined) ?? null;
      } catch { return null; }
    },
    color: {
      border:   'border-blue-500/40',
      text:     'text-blue-400',
      textDim:  'text-blue-400/60',
      bg:       'bg-blue-500/5',
      dotColor: 'bg-blue-400',
    },
  },
  claude: {
    label:      'CLAUDE OPUS 4.7 ANALYSIS',
    shortLabel: 'CLAUDE',
    endpoint:   '/api/internal/claude-analysis',
    parseChunk(payload) {
      // Anthropic SSE delta: { type: "content_block_delta", delta: { type: "text_delta", text } }
      try {
        const json = JSON.parse(payload);
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
          return json.delta.text as string;
        }
        return null;
      } catch { return null; }
    },
    color: {
      border:   'border-amber-500/40',
      text:     'text-amber-400',
      textDim:  'text-amber-400/60',
      bg:       'bg-amber-500/5',
      dotColor: 'bg-amber-400',
    },
  },
};

// ── Individual analysis output block (no button UI here) ─────────────────────

function AnalysisBlock({
  provider,
  brief,
  runSignal,
  savedText,
  onComplete,
}: {
  provider: Provider;
  brief: AiBriefPayload;
  runSignal: number;
  savedText?: string;
  onComplete?: (provider: Provider, text: string) => void;
}) {
  const [state, setState] = useState<PanelState>('idle');
  const [text, setText]   = useState('');
  const [error, setError] = useState('');
  const runningRef        = useRef(false);
  // Mirror state in a ref so the runSignal effect can read current state without stale closure
  const stateRef          = useRef<PanelState>('idle');
  const setStateSync      = (s: PanelState) => { stateRef.current = s; setState(s); };

  useEffect(() => {
    if (savedText) {
      setText(savedText);
      setStateSync('done');
    }
  }, [savedText]);

  const cfg = CONFIGS[provider];
  const c   = cfg.color;

  async function run() {
    if (runningRef.current) return;
    runningRef.current = true;
    setStateSync('loading');
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
        setStateSync('error');
        return;
      }

      if (!res.body) { setError('No response body'); setStateSync('error'); return; }

      setStateSync('streaming');
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';
      let accText   = '';   // accumulate for save — avoids stale state closure

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const chunk = cfg.parseChunk(trimmed.slice(5).trim());
          if (chunk) {
            accText += chunk;
            setText(prev => prev + chunk);
          }
        }
      }
      setStateSync('done');
      if (accText) onComplete?.(provider, accText);

      // Persist to DB fire-and-forget (don't await — never block UI)
      if (accText) {
        fetch('/api/internal/save-ai-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brief_id: brief.brief_id, provider, text: accText }),
        }).then(async r => {
          if (!r.ok) {
            const msg = await r.text().catch(() => r.status.toString());
            console.warn(`[ai-analysis] save failed (${provider}):`, msg);
          }
        }).catch(err => {
          console.warn(`[ai-analysis] save network error (${provider}):`, err);
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setStateSync('error');
    } finally {
      runningRef.current = false;
    }
  }

  useEffect(() => {
    // Only auto-trigger if the panel is idle — prevents accidental re-runs
    // when the toolbar button is clicked on an already-active panel.
    // Use ↻ RE-RUN in the panel header to intentionally re-run.
    if (runSignal > 0 && stateRef.current === 'idle') run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSignal]);

  // Hide only when nothing saved and never run; show saved text immediately via props
  if (state === 'idle' && !savedText) return null;

  const effectiveState =
    state === 'idle' && savedText ? 'done' : state;
  const effectiveText = text || savedText || '';

  const isFromSave = effectiveState === 'done' && !!savedText && effectiveText === savedText;

  return (
    <div className={`pt-3 border-t ${c.border}`}>
      <div className="flex items-center gap-3 mb-2">
        <span className={`text-[10px] tracking-widest font-medium uppercase ${c.textDim}`}>
          {cfg.label}
        </span>
        {(effectiveState === 'loading' || effectiveState === 'streaming') && (
          <span className={`text-[10px] ${c.text} animate-pulse`}>● THINKING…</span>
        )}
        {effectiveState === 'done' && (
          <>
            {isFromSave && (
              <span className="text-[10px] text-fg-dim tracking-widest">SAVED</span>
            )}
            <button
              type="button"
              onClick={run}
              className="text-[10px] text-fg-dim hover:text-fg tracking-widest transition-colors"
            >
              ↻ RE-RUN
            </button>
          </>
        )}
      </div>

      {effectiveState === 'error' && (
        <p className="text-xs text-signal-sell">{error}</p>
      )}
      {effectiveState === 'loading' && (
        <p className={`text-xs ${c.textDim} animate-pulse tracking-widest`}>
          Assembling brief data…
        </p>
      )}
      {(effectiveState === 'streaming' || effectiveState === 'done') && effectiveText && (
        <div className={`text-xs text-fg-muted leading-relaxed whitespace-pre-wrap font-mono border ${c.border} ${c.bg} px-4 py-3`}>
          {effectiveText}
          {effectiveState === 'streaming' && (
            <span className={`inline-block w-1.5 h-3 ${c.dotColor} animate-pulse ml-0.5 align-middle`} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Container ─────────────────────────────────────────────────────────────────

export function AiBriefAnalysis({
  brief,
  savedAnalyses,
}: {
  brief: AiBriefPayload;
  savedAnalyses?: SavedAnalyses;
}) {
  const [signals, setSignals] = useState<Record<Provider, number>>({
    openai: 0,
    gemini: 0,
    claude: 0,
  });
  const [panelTexts, setPanelTexts] = useState<Partial<Record<Provider, string>>>({});
  const [consensusSignal, setConsensusSignal] = useState(0);
  const [awaitingConsensus, setAwaitingConsensus] = useState(false);
  const completedRef = useRef<Set<Provider>>(new Set());

  const handleComplete = useCallback((provider: Provider, text: string) => {
    setPanelTexts(prev => ({ ...prev, [provider]: text }));
    completedRef.current.add(provider);
    if (completedRef.current.size >= 3) {
      setConsensusSignal(s => s + 1);
      setAwaitingConsensus(false);
    }
  }, []);

  function trigger(provider: Provider) {
    setSignals(prev => ({ ...prev, [provider]: prev[provider] + 1 }));
  }

  function runAll() {
    completedRef.current = new Set();
    setPanelTexts({});
    setAwaitingConsensus(true);
    setSignals(prev => ({
      openai: prev.openai + 1,
      gemini: prev.gemini + 1,
      claude: prev.claude + 1,
    }));
  }

  function synthesizeNow() {
    setConsensusSignal(s => s + 1);
  }

  const modelTexts: Partial<Record<Provider, string>> = {
    openai: panelTexts.openai ?? savedAnalyses?.openai,
    gemini: panelTexts.gemini ?? savedAnalyses?.gemini,
    claude: panelTexts.claude ?? savedAnalyses?.claude,
  };
  const modelCount = PROVIDERS.filter(p => modelTexts[p]?.trim()).length;
  const hasSaved =
    savedAnalyses &&
    Object.keys(savedAnalyses).some(k => k === 'openai' || k === 'gemini' || k === 'claude');

  return (
    <div className="mt-4 pt-3 border-t border-border-subtle space-y-4">

      <ConsensusVerdict
        brief={brief}
        analyses={modelTexts}
        savedText={savedAnalyses?.consensus}
        autoRunSignal={consensusSignal}
      />

      {awaitingConsensus && modelCount < 3 && (
        <p className="text-[10px] text-fg-dim tracking-widest animate-pulse">
          Final verdict runs when all 3 models finish…
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {PROVIDERS.map(p => {
          const cfg     = CONFIGS[p];
          const c       = cfg.color;
          const ran     = signals[p] > 0;
          const isSaved = !ran && !!savedAnalyses?.[p];
          return (
            <button
              key={p}
              type="button"
              onClick={() => trigger(p)}
              title={isSaved ? `Refresh ${cfg.label}` : ran ? `Re-run ${cfg.label}` : `Run ${cfg.label}`}
              className={`text-xs px-3 py-1.5 border ${c.border} ${c.text} hover:opacity-90 tracking-widest transition-colors`}
            >
              {ran ? `↻ ${cfg.shortLabel}` : `✦ ${cfg.shortLabel}`}
            </button>
          );
        })}

        <span className="text-fg-dim/30 text-xs select-none">|</span>

        <button
          type="button"
          onClick={runAll}
          className="text-xs px-3 py-1.5 border border-fg-subtle/30 text-fg-subtle hover:border-fg-subtle hover:text-fg tracking-widest transition-colors"
        >
          {hasSaved ? '↻ REFRESH ALL' : '✦ RUN ALL'}
        </button>

        <button
          type="button"
          onClick={synthesizeNow}
          disabled={modelCount < 2}
          title={modelCount < 2 ? 'Run at least 2 AI analyses first' : 'Synthesize final GO/NO-GO verdict'}
          className="text-xs px-3 py-1.5 border border-emerald-500/40 text-emerald-400 hover:opacity-90 tracking-widest transition-colors disabled:opacity-40"
        >
          ⚖ FINAL VERDICT
        </button>
      </div>

      {PROVIDERS.map(p => (
        <AnalysisBlock
          key={p}
          provider={p}
          brief={brief}
          runSignal={signals[p]}
          savedText={savedAnalyses?.[p]}
          onComplete={handleComplete}
        />
      ))}
    </div>
  );
}
