'use client';

import Link from 'next/link';
import type { AiBriefPayload, SavedAnalyses } from '@/components/AiBriefAnalysis';
import {
  SCAN_ALL_BTN,
  ScanAgeLabel,
  ScanAllPipeline,
} from '@/components/scanAll/ScanAllPipeline';
import { stubAiBriefPayload } from '@/lib/stubAiBriefPayload';

export function HomeScanAllCell({
  ticker,
  earningsDate,
  briefId,
  lastAiScanAt,
  lastConsensusAt,
  consensusText,
  compact,
}: {
  ticker: string;
  earningsDate: string;
  briefId?: string;
  lastAiScanAt?: string | null;
  lastConsensusAt?: string | null;
  consensusText?: string | null;
  compact?: boolean;
}) {
  const brief: AiBriefPayload = briefId
    ? stubAiBriefPayload(ticker, earningsDate, briefId)
    : stubAiBriefPayload(ticker, earningsDate);

  const savedAnalyses: SavedAnalyses | undefined = consensusText
    ? { consensus: consensusText }
    : undefined;

  return (
    <ScanAllPipeline
      brief={brief}
      savedAnalyses={savedAnalyses}
      lastAiScanAt={lastAiScanAt}
      lastConsensusAt={lastConsensusAt}
      hidePanels
    >
      {c => (
        <div className={compact ? 'space-y-1.5' : 'flex flex-col items-stretch gap-1 min-w-0'}>
          <button
            type="button"
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              c.scanAll();
            }}
            disabled={c.scanDisabled}
            title={c.scanTitle}
            className={`${SCAN_ALL_BTN} ai-verdict-btn w-full ${
              c.scanDisabled
                ? 'opacity-60 cursor-not-allowed'
                : 'border-border hover:border-signal-buy hover:text-signal-buy'
            } ${c.scanInFlight ? 'border-signal-watch text-signal-watch animate-pulse' : ''}`}
          >
            {c.buttonLabel}
          </button>
          {c.phaseLabel && (
            <span className="text-[10px] text-fg-muted animate-pulse block text-center">
              {c.phaseLabel}
            </span>
          )}
          <ScanAgeLabel
            at={c.effectiveLastScanAllAt}
            neverLabel="Not scanned"
            align={compact ? 'center' : 'start'}
          />
          {c.scanError && (
            <p className="text-[10px] text-signal-sell leading-snug">{c.scanError}</p>
          )}
          {c.peerNotice && !compact && (
            <p className="text-[10px] text-signal-watch leading-snug">{c.peerNotice}</p>
          )}
        </div>
      )}
    </ScanAllPipeline>
  );
}

export function HomeBriefLink({
  briefId,
  className,
}: {
  briefId: string;
  className?: string;
}) {
  return (
    <Link
      href={`/briefs/${briefId}`}
      className={className ?? 'text-[10px] text-fg-dim hover:text-fg-subtle tracking-widest'}
      onClick={e => e.stopPropagation()}
    >
      BRIEF →
    </Link>
  );
}
