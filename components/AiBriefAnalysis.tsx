'use client';

import type { WhaleIntelContext } from '@/lib/intelImages';
import type { NarrativeOverhang } from '@/lib/screamTest';
import type { NewsOverallSentiment, RawHeadline } from '@/lib/newsSentiment';
import { ScanSignalStrip } from '@/components/ScanSignalStrip';
import {
  SCAN_ALL_BTN,
  ScanAgeLabel,
  ScanAllPipeline,
} from '@/components/scanAll/ScanAllPipeline';
import { formatCooldownWait } from '@/lib/aiScanCooldown';

export type SavedAnalyses = Partial<
  Record<'openai' | 'gemini' | 'claude' | 'consensus', string>
>;

export type SavedAnalysisTimes = Partial<
  Record<'openai' | 'gemini' | 'claude' | 'consensus', string>
>;

export type AiBriefPayload = {
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
  raw_headlines: RawHeadline[] | null;
  news_sentiment: NewsOverallSentiment | null;
  spot_price?: number | null;
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
  whale_intel?: WhaleIntelContext | null;
};

export function AiBriefAnalysis({
  brief,
  savedAnalyses,
  savedAnalysisAt,
  lastAiScanAt,
  lastConsensusAt,
  whaleIntel,
  intelValidating = false,
}: {
  brief: AiBriefPayload;
  savedAnalyses?: SavedAnalyses;
  savedAnalysisAt?: SavedAnalysisTimes;
  lastAiScanAt?: string | null;
  lastConsensusAt?: string | null;
  systemScanAt?: string | null;
  whaleIntel?: WhaleIntelContext | null;
  intelValidating?: boolean;
}) {
  return (
    <ScanAllPipeline
      brief={brief}
      savedAnalyses={savedAnalyses}
      savedAnalysisAt={savedAnalysisAt}
      lastAiScanAt={lastAiScanAt}
      lastConsensusAt={lastConsensusAt}
      whaleIntel={whaleIntel}
      intelValidating={intelValidating}
    >
      {c => (
        <div className="mt-4 pt-3 border-t border-border-subtle space-y-4">
          <div className="brief-action-bar border border-border-subtle md:rounded-sm p-2 sm:p-3 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={c.scanAll}
                disabled={c.scanDisabled}
                title={c.scanTitle}
                className={`${SCAN_ALL_BTN} ai-verdict-btn flex-shrink-0 w-full sm:w-auto ${
                  c.scanDisabled ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              >
                {c.buttonLabel}
              </button>
              <div className="flex-1 min-w-0 space-y-1">
                <ScanAgeLabel
                  at={c.effectiveLastScanAllAt}
                  neverLabel="Not scanned yet"
                  align="end"
                />
                {c.scanOnCooldown && !c.scanInFlight && !c.peerWaitActive && (
                  <span className="text-[10px] text-signal-watch font-mono block sm:text-right">
                    Wait {formatCooldownWait(c.cooldownMs)}
                  </span>
                )}
                {c.peerWaitActive && (
                  <span className="text-[10px] text-signal-watch font-mono block sm:text-right animate-pulse">
                    Waiting for scan to finish…
                  </span>
                )}
                {c.phaseLabel && !c.peerWaitActive && (
                  <span className="text-[10px] text-fg-muted animate-pulse block sm:text-right">
                    {c.phaseLabel === 'System…'
                      ? 'System scan…'
                      : c.phaseLabel === 'AI…'
                        ? 'AI scan (GPT · Gemini · Claude)…'
                        : c.phaseLabel === 'Verdict…'
                          ? 'Final verdict…'
                          : c.phaseLabel}
                  </span>
                )}
              </div>
            </div>

            <ScanSignalStrip chips={c.signalChips} />
          </div>

          {c.peerNotice && (
            <p
              className={`text-xs px-3 py-2 border ${
                c.peerWaitActive
                  ? 'text-signal-watch border-signal-watch/40 bg-signal-watch/5'
                  : 'text-signal-buy border-signal-buy/40 bg-signal-buy/5'
              }`}
            >
              {c.peerNotice}
            </p>
          )}

          {c.scanError && (
            <p className="text-xs text-signal-sell border border-signal-sell/40 bg-signal-sell/5 px-3 py-2">
              {c.scanError}
            </p>
          )}

          <p className="text-[10px] text-fg-dim">
            Add whale screenshots above, then RESCAN to fold OCR intel into the verdict.
          </p>
        </div>
      )}
    </ScanAllPipeline>
  );
}
