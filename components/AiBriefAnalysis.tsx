'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { NarrativeOverhang } from '@/lib/screamTest';
import type { NewsOverallSentiment, RawHeadline } from '@/lib/newsSentiment';
import { ConsensusVerdict } from '@/components/ConsensusVerdict';
import { CopyIconButton } from '@/components/CopyIconButton';
import { DirectionIndicator } from '@/components/DirectionIndicator';
import { RescanBriefButton } from '@/components/RescanBriefButton';
import {
  formatCooldownWait,
  formatScanAge,
  msUntilAiScanAllowed,
} from '@/lib/aiScanCooldown';

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
  /** Raw merged headlines (FMP + Gemini search) with per-headline sentiment tags. */
  raw_headlines: RawHeadline[] | null;
  /** LLM overall news bias from system scan. */
  news_sentiment: NewsOverallSentiment | null;
};

type PanelState = 'idle' | 'loading' | 'streaming' | 'done' | 'error';
type Provider   = 'openai' | 'gemini' | 'claude';

interface ProviderConfig {
  label: string;
  shortLabel: string;
  endpoint: string;
  parseChunk: (payload: string) => string | null;
  color: {
    label: string;
    btn: string;
    box: string;
    dot: string;
    status: string;
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
      label:  'ai-panel-label ai-panel-label--openai',
      btn:    'ai-panel-btn ai-panel-btn--openai',
      box:    'ai-panel-box ai-panel-box--openai',
      dot:    'ai-panel-dot--openai',
      status: 'ai-panel-status--openai',
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
      label:  'ai-panel-label ai-panel-label--gemini',
      btn:    'ai-panel-btn ai-panel-btn--gemini',
      box:    'ai-panel-box ai-panel-box--gemini',
      dot:    'ai-panel-dot--gemini',
      status: 'ai-panel-status--gemini',
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
      label:  'ai-panel-label ai-panel-label--claude',
      btn:    'ai-panel-btn ai-panel-btn--claude',
      box:    'ai-panel-box ai-panel-box--claude',
      dot:    'ai-panel-dot--claude',
      status: 'ai-panel-status--claude',
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
  onTerminal,
}: {
  provider: Provider;
  brief: AiBriefPayload;
  runSignal: number;
  savedText?: string;
  onComplete?: (provider: Provider, text: string) => void;
  onTerminal?: (provider: Provider) => void;
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
      onTerminal?.(provider);
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
  const copyText = effectiveText
    ? `${cfg.label}\n${brief.ticker} · ${brief.earnings_date}\n\n${effectiveText}`
    : '';
  const showDirection =
    !!effectiveText &&
    (effectiveState === 'done' || effectiveState === 'streaming');

  return (
    <div className="pt-3 border-t border-border-subtle">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className={c.label}>{cfg.label}</span>
        {showDirection && <DirectionIndicator text={effectiveText} />}
        <span className="flex-1 min-w-[0.5rem]" />
        {effectiveText && (
          <CopyIconButton text={copyText} label={`Copy ${cfg.shortLabel} analysis`} />
        )}
        {(effectiveState === 'loading' || effectiveState === 'streaming') && (
          <span className={`text-[10px] font-medium ${c.status} animate-pulse`}>● THINKING…</span>
        )}
        {effectiveState === 'done' && (
          <>
            {isFromSave && (
              <span className="text-[10px] text-fg-dim tracking-widest">SAVED</span>
            )}
            <button
              type="button"
              onClick={run}
              className={`brief-action-btn brief-action-btn--${provider}`}
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
        <p className={`text-xs ${c.status} animate-pulse tracking-widest font-medium`}>
          Assembling brief data…
        </p>
      )}
      {(effectiveState === 'streaming' || effectiveState === 'done') && effectiveText && (
        <div className={`text-xs text-fg-muted leading-relaxed whitespace-pre-wrap font-mono ${c.box} px-3 py-2.5 sm:px-4 sm:py-3 overflow-x-auto`}>
          {effectiveText}
          {effectiveState === 'streaming' && (
            <span className={`inline-block w-1.5 h-3 ${c.dot} animate-pulse ml-0.5 align-middle`} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Scan age label (re-renders for relative time) ─────────────────────────────

function ScanAgeLabel({ at, neverLabel }: { at: string | null; neverLabel: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!at) return <span className="text-[10px] text-fg-dim">{neverLabel}</span>;
  void tick;
  return (
    <span className="text-[10px] text-fg-dim font-mono tabular-nums">
      Last: {formatScanAge(at)}
    </span>
  );
}

const SCAN_BTN =
  'brief-scan-btn touch-target text-[11px] sm:text-xs px-2 sm:px-3 py-2 sm:py-1.5 border tracking-widest transition-colors';

// ── Container ─────────────────────────────────────────────────────────────────

export function AiBriefAnalysis({
  brief,
  savedAnalyses,
  lastAiScanAt,
  systemScanAt,
}: {
  brief: AiBriefPayload;
  savedAnalyses?: SavedAnalyses;
  lastAiScanAt?: string | null;
  systemScanAt?: string | null;
}) {
  const [signals, setSignals] = useState<Record<Provider, number>>({
    openai: 0,
    gemini: 0,
    claude: 0,
  });
  const [panelTexts, setPanelTexts] = useState<Partial<Record<Provider, string>>>({});
  const [consensusSignal, setConsensusSignal] = useState(0);
  const [awaitingConsensus, setAwaitingConsensus] = useState(false);
  const [aiRunInFlight, setAiRunInFlight] = useState(false);
  const [sessionAiScanAt, setSessionAiScanAt] = useState<string | null>(null);
  const [cooldownTick, setCooldownTick] = useState(0);
  const completedRef = useRef<Set<Provider>>(new Set());
  const terminalRef = useRef<Set<Provider>>(new Set());

  useEffect(() => {
    const id = setInterval(() => setCooldownTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const effectiveLastAiAt = useMemo(() => {
    const a = lastAiScanAt ?? null;
    const b = sessionAiScanAt;
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }, [lastAiScanAt, sessionAiScanAt]);

  void cooldownTick;
  const cooldownMs = msUntilAiScanAllowed(effectiveLastAiAt);
  const aiScanOnCooldown = cooldownMs > 0;

  const handleComplete = useCallback((provider: Provider, text: string) => {
    setPanelTexts(prev => ({ ...prev, [provider]: text }));
    completedRef.current.add(provider);
    if (completedRef.current.size >= 3) {
      setSessionAiScanAt(new Date().toISOString());
      setConsensusSignal(s => s + 1);
      setAwaitingConsensus(false);
    }
  }, []);

  const handleTerminal = useCallback((provider: Provider) => {
    terminalRef.current.add(provider);
    if (terminalRef.current.size >= 3) {
      setAiRunInFlight(false);
      setAwaitingConsensus(false);
    }
  }, []);

  function runAiScan() {
    if (aiScanOnCooldown || aiRunInFlight) return;
    completedRef.current = new Set();
    terminalRef.current = new Set();
    setPanelTexts({});
    setAwaitingConsensus(true);
    setAiRunInFlight(true);
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
  const hasAiSaved = PROVIDERS.some(p => !!savedAnalyses?.[p]);

  const aiScanDisabled = aiScanOnCooldown || aiRunInFlight;
  const aiScanTitle = aiRunInFlight
    ? 'Running GPT, Gemini, and Claude…'
    : aiScanOnCooldown
      ? `Available in ${formatCooldownWait(cooldownMs)} (10 min between full AI scans)`
      : hasAiSaved
        ? 'Re-run all three AI models'
        : 'Run GPT, Gemini, and Claude';

  return (
    <div className="mt-4 pt-3 border-t border-border-subtle space-y-4">

      <div className="brief-action-bar border border-border-subtle md:rounded-sm">
        <div className="brief-toolbar">
          <div className="brief-toolbar-scans">
            <RescanBriefButton
              ticker={brief.ticker}
              earningsDate={brief.earnings_date}
            />
            <button
              type="button"
              onClick={runAiScan}
              disabled={aiScanDisabled}
              title={aiScanTitle}
              className={`${SCAN_BTN} ${
                aiScanDisabled
                  ? 'border-border text-fg-dim cursor-not-allowed opacity-60'
                  : 'border-fg-subtle/30 text-fg-subtle hover:border-fg-subtle hover:text-fg'
              }`}
            >
              {aiRunInFlight ? '⟳ AI SCAN…' : hasAiSaved ? '↻ AI SCAN' : '✦ AI SCAN'}
            </button>
            {aiScanOnCooldown && !aiRunInFlight && (
              <span className="brief-scan-meta text-[10px] text-signal-watch font-mono md:hidden">
                Wait {formatCooldownWait(cooldownMs)}
              </span>
            )}
          </div>

          <div className="brief-toolbar-verdict">
            <button
              type="button"
              onClick={synthesizeNow}
              disabled={modelCount < 2}
              title={
                modelCount < 2
                  ? 'Run AI scan first (need at least 2 model reports)'
                  : 'Synthesize final GO/NO-GO from system + AI reports'
              }
              className="ai-verdict-btn touch-target flex flex-col items-center justify-center disabled:opacity-40 text-[11px] md:text-xs leading-[1.15] whitespace-nowrap"
            >
              <span className="md:hidden flex flex-col items-center text-[10px]">
                <span>⚖ FINAL</span>
                <span>VERDICT</span>
              </span>
              <span className="hidden md:inline">⚖ FINAL VERDICT</span>
            </button>
            <span className="hidden md:inline text-[10px] text-fg-dim text-right">
              Uses system scan + {modelCount}/3 AI reports
            </span>
            <span className="md:hidden text-[10px] text-fg-dim font-mono tabular-nums">
              {modelCount}/3 AI
            </span>
          </div>
        </div>

        <div className="hidden md:grid md:grid-cols-2 md:gap-2 md:mt-2 md:w-max text-[10px] text-fg-dim">
          <ScanAgeLabel at={systemScanAt ?? null} neverLabel="Not scanned yet" />
          <ScanAgeLabel at={effectiveLastAiAt} neverLabel="Never run" />
        </div>
      </div>

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

      {PROVIDERS.map(p => (
        <AnalysisBlock
          key={p}
          provider={p}
          brief={brief}
          runSignal={signals[p]}
          savedText={savedAnalyses?.[p]}
          onComplete={handleComplete}
          onTerminal={handleTerminal}
        />
      ))}
    </div>
  );
}
