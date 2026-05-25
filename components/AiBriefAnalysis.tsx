'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { NarrativeOverhang } from '@/lib/screamTest';
import type { NewsOverallSentiment, RawHeadline } from '@/lib/newsSentiment';
import { ConsensusVerdict } from '@/components/ConsensusVerdict';
import { ScanSignalStrip } from '@/components/ScanSignalStrip';
import { CopyIconButton } from '@/components/CopyIconButton';
import { DirectionIndicator } from '@/components/DirectionIndicator';
import {
  formatCooldownWait,
  formatScanAge,
  latestScanTimestamp,
  msUntilAiScanAllowed,
} from '@/lib/aiScanCooldown';
import { buildScanSignalStrip } from '@/lib/scanSignalStrip';
import { splitAiFinalCall } from '@/lib/aiAnalysisDisplay';

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
  /** Scan-time spot — used for strike anchoring in final verdict. */
  spot_price?: number | null;
  /** System-suggested legs from reconcile / structure engine. */
  suggested_structure?: {
    action?: string;
    preferredExpiry?: string;
    legs?: Array<{
      side: 'BUY' | 'SELL';
      type: 'CALL' | 'PUT';
      strike: number;
      expiry?: string;
    }>;
  } | null;
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

function AiAnalysisBody({
  text,
  streaming,
  boxClass,
  dotClass,
}: {
  text: string;
  streaming: boolean;
  boxClass: string;
  dotClass: string;
}) {
  const { finalCall, rest } = splitAiFinalCall(text);

  if (!finalCall) {
    return (
      <div className={`text-xs text-fg-muted leading-relaxed whitespace-pre-wrap overflow-x-auto ${boxClass}`}>
        {text}
        {streaming && (
          <span className={`inline-block w-1.5 h-3 ${dotClass} animate-pulse ml-0.5 align-middle`} />
        )}
      </div>
    );
  }

  return (
    <div className={`overflow-x-auto ${boxClass}`}>
      <p className="text-xs leading-relaxed text-fg-muted">
        {finalCall}
        {streaming && !rest && (
          <span className={`inline-block w-1.5 h-3 ${dotClass} animate-pulse ml-0.5 align-middle`} />
        )}
      </p>
      {rest && (
        <details className="mt-2 group">
          <summary className="text-[10px] text-fg-dim tracking-widest cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">+ SHOW DETAILS</span>
            <span className="hidden group-open:inline">− HIDE DETAILS</span>
          </summary>
          <div className="mt-2 text-[11px] text-fg-dim leading-relaxed whitespace-pre-wrap font-mono border-t border-border-subtle pt-2">
            {rest}
            {streaming && (
              <span className={`inline-block w-1.5 h-3 ${dotClass} animate-pulse ml-0.5 align-middle`} />
            )}
          </div>
        </details>
      )}
    </div>
  );
}

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
  const lastRunSignal     = useRef(0);
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
    if (runSignal > lastRunSignal.current) {
      lastRunSignal.current = runSignal;
      run();
    }
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
        {effectiveState === 'done' && isFromSave && (
          <span className="text-[10px] text-fg-dim tracking-widest">SAVED</span>
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
        <AiAnalysisBody
          text={effectiveText}
          streaming={effectiveState === 'streaming'}
          boxClass={`${c.box} px-3 py-2.5 sm:px-4 sm:py-3`}
          dotClass={c.dot}
        />
      )}
    </div>
  );
}

// ── Scan age label (re-renders for relative time) ─────────────────────────────

function ScanAgeLabel({
  at,
  neverLabel,
  align = 'center',
}: {
  at: string | null;
  neverLabel: string;
  align?: 'center' | 'end';
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const alignCls = align === 'end' ? 'text-right' : 'text-center';
  if (!at) {
    return (
      <span className={`text-[10px] text-fg-dim ${alignCls} block`}>{neverLabel}</span>
    );
  }
  void tick;
  return (
    <span className={`text-[10px] text-fg-dim font-mono tabular-nums ${alignCls} block`}>
      Last: {formatScanAge(at)}
    </span>
  );
}

type ScanPhase = 'idle' | 'system' | 'ai' | 'verdict' | 'error';

const SCAN_BTN =
  'brief-scan-btn touch-target text-[11px] sm:text-xs px-3 sm:px-4 py-2 sm:py-1.5 border tracking-widest transition-colors w-full sm:w-auto';

// ── Container ─────────────────────────────────────────────────────────────────

export function AiBriefAnalysis({
  brief,
  savedAnalyses,
  lastAiScanAt,
  lastConsensusAt,
  systemScanAt,
}: {
  brief: AiBriefPayload;
  savedAnalyses?: SavedAnalyses;
  lastAiScanAt?: string | null;
  lastConsensusAt?: string | null;
  systemScanAt?: string | null;
}) {
  const [activeBrief, setActiveBrief] = useState(brief);
  useEffect(() => {
    setActiveBrief(brief);
  }, [brief]);

  const [signals, setSignals] = useState<Record<Provider, number>>({
    openai: 0,
    gemini: 0,
    claude: 0,
  });
  const [panelTexts, setPanelTexts] = useState<Partial<Record<Provider, string>>>({});
  const [consensusSignal, setConsensusSignal] = useState(0);
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle');
  const [scanInFlight, setScanInFlight] = useState(false);
  const [scanError, setScanError] = useState('');
  const [sessionScanAllAt, setSessionScanAllAt] = useState<string | null>(null);
  const [sessionAiScanAt, setSessionAiScanAt] = useState<string | null>(null);
  const [sessionConsensusAt, setSessionConsensusAt] = useState<string | null>(null);
  const [cooldownTick, setCooldownTick] = useState(0);
  const completedRef = useRef<Set<Provider>>(new Set());
  const terminalRef = useRef<Set<Provider>>(new Set());
  const scanAllPipelineRef = useRef(false);
  const router = useRouter();

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

  const effectiveLastConsensusAt = useMemo(() => {
    const a = lastConsensusAt ?? null;
    const b = sessionConsensusAt;
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }, [lastConsensusAt, sessionConsensusAt]);

  const effectiveLastScanAllAt = useMemo(
    () =>
      latestScanTimestamp(
        systemScanAt,
        effectiveLastAiAt,
        effectiveLastConsensusAt,
        sessionScanAllAt,
      ),
    [systemScanAt, effectiveLastAiAt, effectiveLastConsensusAt, sessionScanAllAt],
  );

  void cooldownTick;
  const cooldownMs = msUntilAiScanAllowed(effectiveLastScanAllAt);
  const scanOnCooldown = cooldownMs > 0;

  const finishScanAll = useCallback(() => {
    scanAllPipelineRef.current = false;
    setScanInFlight(false);
    setScanPhase('idle');
    setSessionScanAllAt(new Date().toISOString());
    router.refresh();
  }, [router]);

  const failScanAll = useCallback((message: string) => {
    scanAllPipelineRef.current = false;
    setScanInFlight(false);
    setScanPhase('error');
    setScanError(message);
  }, []);

  const handleComplete = useCallback((provider: Provider, text: string) => {
    setPanelTexts(prev => ({ ...prev, [provider]: text }));
    completedRef.current.add(provider);
    if (completedRef.current.size >= 3) {
      setSessionAiScanAt(new Date().toISOString());
      if (scanAllPipelineRef.current) {
        setScanPhase('verdict');
      }
      setConsensusSignal(s => s + 1);
    }
  }, []);

  const handleTerminal = useCallback((provider: Provider) => {
    terminalRef.current.add(provider);
    if (terminalRef.current.size >= 3) {
      if (scanAllPipelineRef.current && completedRef.current.size < 3) {
        failScanAll('One or more AI models failed. Wait for cooldown, then Scan All again.');
      }
    }
  }, [failScanAll]);

  const handleConsensusComplete = useCallback(
    (at: string) => {
      setSessionConsensusAt(at);
      if (scanAllPipelineRef.current) {
        finishScanAll();
      }
    },
    [finishScanAll],
  );

  const handleConsensusError = useCallback(
    (message: string) => {
      if (scanAllPipelineRef.current) {
        failScanAll(message || 'Final verdict failed. Wait for cooldown, then Scan All again.');
      }
    },
    [failScanAll],
  );

  async function scanAll() {
    if (scanOnCooldown || scanInFlight) return;

    setScanError('');
    setScanInFlight(true);
    setScanPhase('system');
    scanAllPipelineRef.current = true;
    completedRef.current = new Set();
    terminalRef.current = new Set();
    setPanelTexts({});

    try {
      const scanRes = await fetch('/api/internal/run-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDate: activeBrief.earnings_date,
          ticker: activeBrief.ticker,
        }),
      });
      const scanData = await scanRes.json().catch(() => ({}));
      if (!scanRes.ok) {
        throw new Error(scanData.error ?? `System scan HTTP ${scanRes.status}`);
      }
      if (scanData.idleReason) {
        const msg =
          scanData.idleReason === 'no_earnings_on_session_date'
            ? `No watchlist row for ${activeBrief.ticker} on ${activeBrief.earnings_date}`
            : `System scan skipped: ${scanData.idleReason}`;
        throw new Error(msg);
      }

      const payloadRes = await fetch('/api/internal/brief-payload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief_id: activeBrief.brief_id }),
      });
      const fresh = await payloadRes.json().catch(() => ({}));
      if (!payloadRes.ok) {
        throw new Error(fresh.error ?? 'Failed to reload brief after system scan');
      }
      setActiveBrief(fresh as AiBriefPayload);

      setScanPhase('ai');
      setSignals(prev => ({
        openai: prev.openai + 1,
        gemini: prev.gemini + 1,
        claude: prev.claude + 1,
      }));
    } catch (e) {
      failScanAll(e instanceof Error ? e.message : 'Scan All failed');
    }
  }

  const modelTexts: Partial<Record<Provider, string>> = scanInFlight
    ? panelTexts
    : {
        openai: panelTexts.openai ?? savedAnalyses?.openai,
        gemini: panelTexts.gemini ?? savedAnalyses?.gemini,
        claude: panelTexts.claude ?? savedAnalyses?.claude,
      };

  const signalChips = useMemo(
    () => buildScanSignalStrip(activeBrief, modelTexts),
    [activeBrief, modelTexts],
  );

  const hasAnySaved =
    !!savedAnalyses?.consensus ||
    PROVIDERS.some(p => !!savedAnalyses?.[p]) ||
    !!systemScanAt;

  const scanDisabled = scanOnCooldown || scanInFlight;
  const scanTitle = scanInFlight
    ? 'Scan All in progress…'
    : scanOnCooldown
      ? `Available in ${formatCooldownWait(cooldownMs)} (10 min between Scan All)`
      : hasAnySaved
        ? 'Re-run system scan, all AI models, and final verdict'
        : 'Run system scan, all AI models, and final verdict';

  const phaseLabel =
    scanPhase === 'system'
      ? 'System scan…'
      : scanPhase === 'ai'
        ? 'AI scan (GPT · Gemini · Claude)…'
        : scanPhase === 'verdict'
          ? 'Final verdict…'
          : null;

  return (
    <div className="mt-4 pt-3 border-t border-border-subtle space-y-4">

      <div className="brief-action-bar border border-border-subtle md:rounded-sm p-2 sm:p-3 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={scanAll}
            disabled={scanDisabled}
            title={scanTitle}
            className={`${SCAN_BTN} ai-verdict-btn flex-shrink-0 ${
              scanDisabled
                ? 'opacity-60 cursor-not-allowed'
                : ''
            }`}
          >
            {scanInFlight ? `⟳ SCAN ALL…` : hasAnySaved ? '↻ SCAN ALL' : '✦ SCAN ALL'}
          </button>
          <div className="flex-1 min-w-0 space-y-1">
            <ScanAgeLabel
              at={effectiveLastScanAllAt}
              neverLabel="Not scanned yet"
              align="end"
            />
            {scanOnCooldown && !scanInFlight && (
              <span className="text-[10px] text-signal-watch font-mono block sm:text-right">
                Wait {formatCooldownWait(cooldownMs)}
              </span>
            )}
            {phaseLabel && (
              <span className="text-[10px] text-fg-muted animate-pulse block sm:text-right">
                {phaseLabel}
              </span>
            )}
          </div>
        </div>

        <ScanSignalStrip chips={signalChips} />
      </div>

      {scanError && (
        <p className="text-xs text-signal-sell border border-signal-sell/40 bg-signal-sell/5 px-3 py-2">
          {scanError}
        </p>
      )}

      <ConsensusVerdict
        brief={activeBrief}
        analyses={modelTexts}
        savedText={scanInFlight ? undefined : savedAnalyses?.consensus}
        autoRunSignal={consensusSignal}
        onComplete={handleConsensusComplete}
        onError={handleConsensusError}
        hideManualControls
      />

      {PROVIDERS.map(p => (
        <AnalysisBlock
          key={p}
          provider={p}
          brief={activeBrief}
          runSignal={signals[p]}
          savedText={scanInFlight ? undefined : savedAnalyses?.[p]}
          onComplete={handleComplete}
          onTerminal={handleTerminal}
        />
      ))}
    </div>
  );
}
