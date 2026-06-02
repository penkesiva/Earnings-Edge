'use client';

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { AiBriefPayload, SavedAnalyses, SavedAnalysisTimes } from '@/components/AiBriefAnalysis';
import { ConsensusVerdict } from '@/components/ConsensusVerdict';
import { CopyIconButton } from '@/components/CopyIconButton';
import { DirectionIndicator } from '@/components/DirectionIndicator';
import { ResponseTimeStamp } from '@/components/ResponseTimeStamp';
import type { WhaleIntelContext } from '@/lib/intelImages';
import {
  formatCooldownWait,
  formatScanAge,
  latestScanTimestamp,
  msUntilAiScanAllowed,
} from '@/lib/aiScanCooldown';
import { buildScanSignalStrip, type ScanSignalChip } from '@/lib/scanSignalStrip';
import { splitAiFinalCall } from '@/lib/aiAnalysisDisplay';
import { msUntilIso } from '@/lib/tickerScanLock';

type PanelState = 'idle' | 'loading' | 'streaming' | 'done' | 'error';
type Provider = 'openai' | 'gemini' | 'claude';
type ScanPhase = 'idle' | 'system' | 'ai' | 'verdict' | 'error';

export const SCAN_ALL_PROVIDERS: Provider[] = ['openai', 'gemini', 'claude'];

export const SCAN_ALL_BTN =
  'brief-scan-btn touch-target text-[11px] sm:text-xs px-3 sm:px-4 py-2 sm:py-1.5 border tracking-widest transition-colors';

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

const CONFIGS: Record<Provider, ProviderConfig> = {
  openai: {
    label: 'GPT-5.5 ANALYSIS',
    shortLabel: 'GPT-5.5',
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
    color: {
      label: 'ai-panel-label ai-panel-label--openai',
      btn: 'ai-panel-btn ai-panel-btn--openai',
      box: 'ai-panel-box ai-panel-box--openai',
      dot: 'ai-panel-dot--openai',
      status: 'ai-panel-status--openai',
    },
  },
  gemini: {
    label: 'GEMINI 3.1 PRO ANALYSIS',
    shortLabel: 'GEMINI',
    endpoint: '/api/internal/gemini-analysis',
    parseChunk(payload) {
      try {
        const json = JSON.parse(payload);
        return (json.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined) ?? null;
      } catch {
        return null;
      }
    },
    color: {
      label: 'ai-panel-label ai-panel-label--gemini',
      btn: 'ai-panel-btn ai-panel-btn--gemini',
      box: 'ai-panel-box ai-panel-box--gemini',
      dot: 'ai-panel-dot--gemini',
      status: 'ai-panel-status--gemini',
    },
  },
  claude: {
    label: 'CLAUDE OPUS 4.7 ANALYSIS',
    shortLabel: 'CLAUDE',
    endpoint: '/api/internal/claude-analysis',
    parseChunk(payload) {
      try {
        const json = JSON.parse(payload);
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
          return json.delta.text as string;
        }
        return null;
      } catch {
        return null;
      }
    },
    color: {
      label: 'ai-panel-label ai-panel-label--claude',
      btn: 'ai-panel-btn ai-panel-btn--claude',
      box: 'ai-panel-box ai-panel-box--claude',
      dot: 'ai-panel-dot--claude',
      status: 'ai-panel-status--claude',
    },
  },
};

async function fetchBriefPayload(brief: AiBriefPayload): Promise<AiBriefPayload> {
  const body = brief.brief_id
    ? { brief_id: brief.brief_id }
    : { ticker: brief.ticker, earnings_date: brief.earnings_date };

  const res = await fetch('/api/internal/brief-payload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? 'Failed to reload brief after system scan');
  }
  return data as AiBriefPayload;
}

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
      <div
        className={`text-xs text-fg-muted leading-relaxed whitespace-pre-wrap overflow-x-auto ${boxClass}`}
      >
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
  scanRunId,
  savedText,
  savedAt,
  onComplete,
  onTerminal,
}: {
  provider: Provider;
  brief: AiBriefPayload;
  runSignal: number;
  scanRunId: string | null;
  savedText?: string;
  savedAt?: string | null;
  onComplete?: (provider: Provider, text: string) => void;
  onTerminal?: (provider: Provider) => void;
}) {
  const [state, setState] = useState<PanelState>('idle');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [responseAt, setResponseAt] = useState<string | null>(null);
  const runningRef = useRef(false);
  const lastRunSignal = useRef(0);
  const stateRef = useRef<PanelState>('idle');
  const setStateSync = (s: PanelState) => {
    stateRef.current = s;
    setState(s);
  };

  useEffect(() => {
    if (savedText) {
      setText(savedText);
      setStateSync('done');
      if (savedAt) setResponseAt(savedAt);
    }
  }, [savedText, savedAt]);

  const cfg = CONFIGS[provider];
  const c = cfg.color;

  async function run() {
    if (runningRef.current) return;
    runningRef.current = true;
    setStateSync('loading');
    setText('');
    setError('');
    setResponseAt(null);

    try {
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief,
          ...(scanRunId ? { scan_run_id: scanRunId } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `HTTP ${res.status}`);
        setStateSync('error');
        return;
      }

      if (!res.body) {
        setError('No response body');
        setStateSync('error');
        return;
      }

      setStateSync('streaming');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accText = '';

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
      if (accText) {
        const at = new Date().toISOString();
        setResponseAt(at);
        onComplete?.(provider, accText);
      }

      if (accText && brief.brief_id) {
        fetch('/api/internal/save-ai-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brief_id: brief.brief_id, provider, text: accText }),
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

  if (state === 'idle' && !savedText) return null;

  const effectiveState = state === 'idle' && savedText ? 'done' : state;
  const effectiveText = text || savedText || '';
  const isFromSave = effectiveState === 'done' && !!savedText && effectiveText === savedText;
  const copyText = effectiveText
    ? `${cfg.label}\n${brief.ticker} · ${brief.earnings_date}\n\n${effectiveText}`
    : '';
  const showDirection =
    !!effectiveText && (effectiveState === 'done' || effectiveState === 'streaming');

  return (
    <div className="pt-3 border-t border-border-subtle relative pb-5">
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

      {effectiveState === 'error' && <p className="text-xs text-signal-sell">{error}</p>}
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
      <ResponseTimeStamp at={responseAt} className="absolute bottom-0 right-0" />
    </div>
  );
}

export function ScanAgeLabel({
  at,
  neverLabel,
  align = 'center',
}: {
  at: string | null;
  neverLabel: string;
  align?: 'center' | 'end' | 'start';
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const alignCls =
    align === 'end' ? 'text-right' : align === 'start' ? 'text-left' : 'text-center';
  if (!at) {
    return <span className={`text-[10px] text-fg-dim ${alignCls} block`}>{neverLabel}</span>;
  }
  void tick;
  return (
    <span className={`text-[10px] text-fg-dim font-mono tabular-nums ${alignCls} block`}>
      {formatScanAge(at)}
    </span>
  );
}

export type ScanAllControls = {
  scanAll: () => void;
  scanDisabled: boolean;
  scanInFlight: boolean;
  scanOnCooldown: boolean;
  cooldownMs: number;
  phaseLabel: string | null;
  scanTitle: string;
  buttonLabel: string;
  hasAnySaved: boolean;
  effectiveLastScanAllAt: string | null;
  peerWaitActive: boolean;
  peerNotice: string | null;
  scanError: string;
  signalChips: ScanSignalChip[];
  activeBrief: AiBriefPayload;
  verdictPanel: ReactNode;
  analysisPanels: ReactNode;
};

export function ScanAllPipeline({
  brief,
  savedAnalyses,
  savedAnalysisAt,
  lastAiScanAt,
  lastConsensusAt,
  whaleIntel,
  intelValidating = false,
  hidePanels = false,
  children,
}: {
  brief: AiBriefPayload;
  savedAnalyses?: SavedAnalyses;
  savedAnalysisAt?: SavedAnalysisTimes;
  lastAiScanAt?: string | null;
  lastConsensusAt?: string | null;
  whaleIntel?: WhaleIntelContext | null;
  intelValidating?: boolean;
  hidePanels?: boolean;
  children: (controls: ScanAllControls) => ReactNode;
}) {
  const [activeBrief, setActiveBrief] = useState(brief);
  useEffect(() => {
    setActiveBrief(brief);
  }, [brief]);

  const briefForAi = useMemo(
    () => ({ ...activeBrief, whale_intel: whaleIntel ?? null }),
    [activeBrief, whaleIntel],
  );

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
  const [scanRunId, setScanRunId] = useState<string | null>(null);
  const [serverLockUntil, setServerLockUntil] = useState<string | null>(null);
  const [peerWaitActive, setPeerWaitActive] = useState(false);
  const [peerNotice, setPeerNotice] = useState<string | null>(null);
  const [sessionScanAllAt, setSessionScanAllAt] = useState<string | null>(null);
  const [sessionAiScanAt, setSessionAiScanAt] = useState<string | null>(null);
  const [sessionConsensusAt, setSessionConsensusAt] = useState<string | null>(null);
  const [cooldownTick, setCooldownTick] = useState(0);
  const completedRef = useRef<Set<Provider>>(new Set());
  const terminalRef = useRef<Set<Provider>>(new Set());
  const scanAllPipelineRef = useRef(false);
  const waitBaselineRef = useRef<string | null>(null);
  const peerAutoDetectRef = useRef(false);
  const router = useRouter();

  const refreshLockStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/internal/scan-all-lock?ticker=${encodeURIComponent(brief.ticker)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setServerLockUntil(data.isLocked ? (data.lockedUntil as string) : null);
    } catch {
      // Non-fatal.
    }
  }, [brief.ticker]);

  useEffect(() => {
    refreshLockStatus();
  }, [refreshLockStatus]);

  useEffect(() => {
    const id = setInterval(refreshLockStatus, 30_000);
    return () => clearInterval(id);
  }, [refreshLockStatus]);

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
      latestScanTimestamp(effectiveLastAiAt, effectiveLastConsensusAt, sessionScanAllAt),
    [effectiveLastAiAt, effectiveLastConsensusAt, sessionScanAllAt],
  );

  void cooldownTick;
  const legacyCooldownMs = msUntilAiScanAllowed(effectiveLastScanAllAt);
  const serverCooldownMs = msUntilIso(serverLockUntil);
  const cooldownMs = Math.max(legacyCooldownMs, serverCooldownMs);
  const scanOnCooldown = cooldownMs > 0;

  useEffect(() => {
    if (!brief.brief_id || peerAutoDetectRef.current || scanRunId || scanInFlight) return;
    peerAutoDetectRef.current = true;

    let cancelled = false;
    (async () => {
      const q = new URLSearchParams({
        brief_id: brief.brief_id,
        ticker: brief.ticker,
        earnings_date: brief.earnings_date,
      });
      const res = await fetch(`/api/internal/brief-scan-status?${q}`);
      if (!res.ok || cancelled) return;
      const data = await res.json();
      if (cancelled || !data.isLocked || data.scanCompleteForLock) return;

      setServerLockUntil(data.lockedUntil as string);
      setPeerWaitActive(true);
      setPeerNotice(`${brief.ticker} scan in progress — results will appear automatically…`);
      waitBaselineRef.current = effectiveLastScanAllAt;
    })();

    return () => {
      cancelled = true;
    };
  }, [
    brief.brief_id,
    brief.ticker,
    brief.earnings_date,
    effectiveLastScanAllAt,
    scanInFlight,
    scanRunId,
  ]);

  useEffect(() => {
    if (!peerWaitActive || scanInFlight) return;

    const poll = async () => {
      const briefId = brief.brief_id || activeBrief.brief_id;
      if (!briefId) return;

      const q = new URLSearchParams({
        brief_id: briefId,
        ticker: brief.ticker,
        earnings_date: brief.earnings_date,
      });
      const res = await fetch(`/api/internal/brief-scan-status?${q}`);
      if (!res.ok) return;
      const data = await res.json();

      setServerLockUntil(data.isLocked ? (data.lockedUntil as string) : null);

      const baseline = waitBaselineRef.current ?? effectiveLastScanAllAt;
      const latest = (data.latestResultsAt as string | null) ?? null;
      const complete = data.scanCompleteForLock as boolean;

      if (complete || (latest && (!baseline || latest > baseline))) {
        setPeerWaitActive(false);
        setPeerNotice(`${brief.ticker} scan complete — results updated`);
        waitBaselineRef.current = latest ?? baseline;
        router.refresh();
        window.setTimeout(() => setPeerNotice(null), 6000);
      }
    };

    poll();
    const id = window.setInterval(poll, 4000);
    return () => window.clearInterval(id);
  }, [
    peerWaitActive,
    scanInFlight,
    brief.brief_id,
    brief.ticker,
    brief.earnings_date,
    activeBrief.brief_id,
    router,
    effectiveLastScanAllAt,
  ]);

  const finishScanAll = useCallback(() => {
    scanAllPipelineRef.current = false;
    setScanInFlight(false);
    setScanPhase('idle');
    setSessionScanAllAt(new Date().toISOString());
    router.refresh();
    refreshLockStatus();
  }, [router, refreshLockStatus]);

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
      if (scanAllPipelineRef.current) setScanPhase('verdict');
      setConsensusSignal(s => s + 1);
    }
  }, []);

  const handleTerminal = useCallback(
    (provider: Provider) => {
      terminalRef.current.add(provider);
      if (terminalRef.current.size >= 3) {
        if (scanAllPipelineRef.current && completedRef.current.size < 3) {
          failScanAll('One or more AI models failed. Wait for cooldown, then try again.');
        }
      }
    },
    [failScanAll],
  );

  const handleConsensusComplete = useCallback(
    (at: string) => {
      setSessionConsensusAt(at);
      if (scanAllPipelineRef.current) finishScanAll();
    },
    [finishScanAll],
  );

  const handleConsensusError = useCallback(
    (message: string) => {
      if (scanAllPipelineRef.current) {
        failScanAll(message || 'Final verdict failed. Wait for cooldown, then try again.');
      }
    },
    [failScanAll],
  );

  const scanAll = useCallback(async () => {
    if (scanOnCooldown || scanInFlight || intelValidating) return;

    setScanError('');

    try {
      const lockRes = await fetch('/api/internal/scan-all-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: activeBrief.ticker,
          ...(activeBrief.brief_id ? { brief_id: activeBrief.brief_id } : {}),
        }),
      });
      const lockData = await lockRes.json().catch(() => ({}));
      if (!lockRes.ok) {
        if (lockData.lockedUntil) setServerLockUntil(lockData.lockedUntil as string);
        waitBaselineRef.current = effectiveLastScanAllAt;
        setPeerWaitActive(true);
        setPeerNotice(
          (lockData.message as string) ??
            `${activeBrief.ticker} scan in progress — results will appear automatically…`,
        );
        return;
      }

      const runId = lockData.runId as string;
      const lockedUntil = lockData.lockedUntil as string;
      setScanRunId(runId);
      setServerLockUntil(lockedUntil);

      setScanInFlight(true);
      setScanPhase('system');
      scanAllPipelineRef.current = true;
      completedRef.current = new Set();
      terminalRef.current = new Set();
      setPanelTexts({});

      const scanRes = await fetch('/api/internal/run-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDate: activeBrief.earnings_date,
          ticker: activeBrief.ticker,
          scan_run_id: runId,
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

      const fresh = await fetchBriefPayload(activeBrief);
      setActiveBrief(fresh);

      setScanPhase('ai');
      setSignals(prev => ({
        openai: prev.openai + 1,
        gemini: prev.gemini + 1,
        claude: prev.claude + 1,
      }));
    } catch (e) {
      failScanAll(e instanceof Error ? e.message : 'Scan All failed');
    }
  }, [
    scanOnCooldown,
    scanInFlight,
    intelValidating,
    activeBrief,
    effectiveLastScanAllAt,
    failScanAll,
  ]);

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
    SCAN_ALL_PROVIDERS.some(p => !!savedAnalyses?.[p]) ||
    !!effectiveLastScanAllAt;

  const scanDisabled = scanOnCooldown || scanInFlight || intelValidating || peerWaitActive;
  const scanTitle = intelValidating
    ? 'Wait for screenshot validation to finish'
    : scanInFlight
      ? 'Scan All in progress…'
      : peerWaitActive
        ? 'Another scan in progress for this ticker'
        : scanOnCooldown
          ? `Available in ${formatCooldownWait(cooldownMs)}`
          : hasAnySaved
            ? 'Re-run system scan, all AI models, and final verdict'
            : 'Run system scan, all AI models, and final verdict';

  const phaseLabel =
    scanPhase === 'system'
      ? 'System…'
      : scanPhase === 'ai'
        ? 'AI…'
        : scanPhase === 'verdict'
          ? 'Verdict…'
          : peerWaitActive
            ? 'Waiting…'
            : null;

  const buttonLabel = scanInFlight
    ? '⟳ SCAN ALL…'
    : peerWaitActive
      ? '… WAIT'
      : scanOnCooldown
        ? formatCooldownWait(cooldownMs)
        : hasAnySaved
          ? '↻ RESCAN'
          : '✦ SCAN ALL';

  const panelWrap = hidePanels ? 'sr-only' : undefined;

  const verdictPanel = (
    <ConsensusVerdict
      brief={briefForAi}
      analyses={modelTexts}
      savedText={scanInFlight ? undefined : savedAnalyses?.consensus}
      savedAt={scanInFlight ? undefined : savedAnalysisAt?.consensus ?? lastConsensusAt}
      autoRunSignal={consensusSignal}
      scanRunId={scanRunId}
      onComplete={handleConsensusComplete}
      onError={handleConsensusError}
      hideManualControls
    />
  );

  const analysisPanels = (
    <>
      {SCAN_ALL_PROVIDERS.map(p => (
        <AnalysisBlock
          key={p}
          provider={p}
          brief={briefForAi}
          runSignal={signals[p]}
          scanRunId={scanRunId}
          savedText={scanInFlight ? undefined : savedAnalyses?.[p]}
          savedAt={scanInFlight ? undefined : savedAnalysisAt?.[p]}
          onComplete={handleComplete}
          onTerminal={handleTerminal}
        />
      ))}
    </>
  );

  const controls: ScanAllControls = {
    scanAll,
    scanDisabled,
    scanInFlight,
    scanOnCooldown,
    cooldownMs,
    phaseLabel,
    scanTitle,
    buttonLabel,
    hasAnySaved,
    effectiveLastScanAllAt,
    peerWaitActive,
    peerNotice,
    scanError,
    signalChips,
    activeBrief,
    verdictPanel,
    analysisPanels,
  };

  return (
    <>
      {children(controls)}
      {hidePanels && (
        <div className={panelWrap} aria-hidden={hidePanels}>
          {verdictPanel}
          {analysisPanels}
        </div>
      )}
    </>
  );
}
