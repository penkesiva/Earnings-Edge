'use client';

import { useCallback, useState, type ReactNode } from 'react';
import type { AiBriefPayload, SavedAnalyses, SavedAnalysisTimes } from '@/components/AiBriefAnalysis';
import { BriefIntelImages } from '@/components/BriefIntelImages';
import { ScanSignalStrip } from '@/components/ScanSignalStrip';
import {
  SCAN_ALL_BTN,
  ScanAgeLabel,
  ScanAllPipeline,
} from '@/components/scanAll/ScanAllPipeline';
import { formatCooldownWait } from '@/lib/aiScanCooldown';
import type { IntelImageItem, WhaleIntelContext } from '@/lib/intelImages';

export function BriefAnalysisPanel({
  brief,
  savedAnalyses,
  savedAnalysisAt,
  lastAiScanAt,
  lastConsensusAt,
  systemScanAt,
  systemRow,
}: {
  brief: AiBriefPayload;
  savedAnalyses?: SavedAnalyses;
  savedAnalysisAt?: SavedAnalysisTimes;
  lastAiScanAt?: string | null;
  lastConsensusAt?: string | null;
  systemScanAt?: string | null;
  systemRow?: ReactNode;
}) {
  const [whaleIntel, setWhaleIntel] = useState<WhaleIntelContext | null>(null);
  const [intelBusy, setIntelBusy] = useState(false);

  const handleIntelChange = useCallback(
    (intel: WhaleIntelContext | null, items: IntelImageItem[]) => {
      setWhaleIntel(intel);
      setIntelBusy(items.some(i => i.status === 'validating' || i.status === 'pending'));
    },
    [],
  );

  return (
    <ScanAllPipeline
      brief={brief}
      savedAnalyses={savedAnalyses}
      savedAnalysisAt={savedAnalysisAt}
      lastAiScanAt={lastAiScanAt}
      lastConsensusAt={lastConsensusAt}
      whaleIntel={whaleIntel}
      intelValidating={intelBusy}
    >
      {c => (
        <div className="mt-4 pt-3 border-t border-border-subtle space-y-4">
          {/* 1 — Rescan / Scan All */}
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

          {/* 2 — Final Verdict */}
          {c.verdictPanel}

          {/* 3 — System row */}
          {systemRow}

          {/* 4 — Whale intel */}
          <BriefIntelImages ticker={brief.ticker} onIntelChange={handleIntelChange} />

          {/* 5 — AI analysis panels */}
          {c.analysisPanels}
        </div>
      )}
    </ScanAllPipeline>
  );
}
