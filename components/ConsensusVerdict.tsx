'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiBriefPayload } from '@/components/AiBriefAnalysis';
import { CopyIconButton } from '@/components/CopyIconButton';
import { DirectionIndicator } from '@/components/DirectionIndicator';
import {
  buildAlignmentChips,
  finalVerdictPanelBorder,
  finalVerdictTextCls,
  formatConsensusForCopy,
  parseSynthesisResponse,
  resolveVerdictWhy,
  type AlignmentChip,
  type Direction,
} from '@/lib/aiConsensus';

type PanelState = 'idle' | 'loading' | 'done' | 'error';

function directionCls(d: Direction | null): string {
  if (d === 'UP') return 'text-signal-buy';
  if (d === 'DOWN') return 'text-signal-sell';
  return 'text-fg-muted';
}

function Chip({ chip }: { chip: AlignmentChip }) {
  const mark =
    chip.status === 'yes' ? '✓' :
    chip.status === 'no' ? '✗' : '—';
  const markCls =
    chip.status === 'yes' ? 'alignment-mark alignment-mark--yes' :
    chip.status === 'no' ? 'alignment-mark alignment-mark--no' :
    'alignment-mark alignment-mark--miss';
  return (
    <span className="text-[11px] text-fg-muted font-medium">
      {chip.label}
      <span className={markCls} aria-hidden>{mark}</span>
    </span>
  );
}

export function ConsensusVerdict({
  brief,
  analyses,
  savedText,
  autoRunSignal,
}: {
  brief: AiBriefPayload;
  analyses: Partial<Record<'openai' | 'gemini' | 'claude', string>>;
  savedText?: string;
  autoRunSignal: number;
}) {
  const [state, setState] = useState<PanelState>('idle');
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (savedText) {
      setText(savedText);
      setState('done');
    }
  }, [savedText]);

  const run = useCallback(async () => {
    const filled = (['openai', 'gemini', 'claude'] as const).filter(p => analyses[p]?.trim());
    if (filled.length < 2) {
      setError('Run at least 2 AI analyses first');
      setState('error');
      return;
    }

    setState('loading');
    setError('');

    try {
      const res = await fetch('/api/internal/synthesis-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, analyses }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setState('error');
        return;
      }
      const out = data.text as string;
      setText(out);
      setState('done');

      fetch('/api/internal/save-ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief_id: brief.brief_id,
          provider: 'consensus',
          text: out,
        }),
      }).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setState('error');
    }
  }, [analyses, brief]);

  const lastAutoSignal = useRef(0);
  useEffect(() => {
    if (autoRunSignal > lastAutoSignal.current) {
      lastAutoSignal.current = autoRunSignal;
      const count = (['openai', 'gemini', 'claude'] as const).filter(p => analyses[p]?.trim()).length;
      if (count >= 2) run();
    }
  }, [autoRunSignal, analyses, run]);

  const effectiveState = state === 'idle' && savedText ? 'done' : state;
  const effectiveText = text || savedText || '';

  if (effectiveState === 'idle' && !savedText) return null;

  if (effectiveState === 'loading') {
    return (
      <div className="px-4 py-3 ai-verdict-box">
        <p className="text-xs final-verdict-label animate-pulse">
          SYNTHESIZING FINAL VERDICT…
        </p>
      </div>
    );
  }

  if (effectiveState === 'error') {
    return (
      <div className="border border-signal-sell/40 bg-signal-sell/5 px-4 py-3">
        <p className="text-xs text-signal-sell">{error}</p>
        <button
          type="button"
          onClick={run}
          className="brief-action-btn brief-action-btn--verdict mt-2"
        >
          ↻ RETRY SYNTHESIS
        </button>
      </div>
    );
  }

  const parsed = effectiveText ? parseSynthesisResponse(effectiveText) : null;
  if (!parsed) return null;

  const { summary: alignSummary, chips } = buildAlignmentChips(
    brief,
    analyses,
    parsed.direction
  );
  const whyText = resolveVerdictWhy(parsed, analyses);

  const isSaved = !!savedText && effectiveText === savedText;
  const copyText = formatConsensusForCopy(parsed, whyText, alignSummary, brief.ticker);

  return (
    <div className={`border px-4 py-3 space-y-2 ${finalVerdictPanelBorder(parsed.verdict, parsed.direction)}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="final-verdict-label">Final verdict</span>
          {parsed.direction && <DirectionIndicator direction={parsed.direction} />}
        </div>
        <div className="flex items-center gap-2">
          <CopyIconButton text={copyText} label="Copy final verdict" />
          {isSaved && (
            <span className="text-[10px] text-fg-dim tracking-widest">SAVED</span>
          )}
          <button
            type="button"
            onClick={run}
            className="brief-action-btn brief-action-btn--verdict"
          >
            ↻ RE-SYNTHESIZE
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={`text-lg font-bold tracking-tight ${finalVerdictTextCls(parsed.verdict, parsed.direction)}`}
        >
          {parsed.verdict}
        </span>
        {parsed.direction && (
          <>
            <span className="text-fg-dim">·</span>
            <span className={`text-lg font-bold ${directionCls(parsed.direction)}`}>
              {parsed.direction}
            </span>
          </>
        )}
        {parsed.confidence && (
          <>
            <span className="text-fg-dim">·</span>
            <span className="text-sm text-fg-muted font-mono">{parsed.confidence}</span>
          </>
        )}
      </div>

      {parsed.move && <p className="text-sm font-mono text-fg">{parsed.move}</p>}
      {whyText && (
        <p className="text-sm text-fg leading-relaxed border-l-2 border-border-subtle pl-3">
          {whyText}
        </p>
      )}
      {parsed.trade && (
        <p className="text-xs text-fg-muted leading-relaxed">
          <span className="text-fg-dim tracking-widest text-[10px]">TRADE </span>
          {parsed.trade}
        </p>
      )}
      <p className="text-[11px] text-fg font-mono leading-relaxed overflow-x-auto pb-1 -mx-1 px-1">
        <span className="font-semibold text-fg-muted">{alignSummary}</span>
        <span className="text-fg-dim"> — </span>
        {chips.map((chip, i) => (
          <span key={chip.label}>
            {i > 0 && <span className="text-fg-dim"> · </span>}
            <Chip chip={chip} />
          </span>
        ))}
      </p>
    </div>
  );
}
