'use client';

import { useCallback, useState } from 'react';
import { AiBriefAnalysis, type AiBriefPayload, type SavedAnalyses, type SavedAnalysisTimes } from '@/components/AiBriefAnalysis';
import { BriefIntelImages } from '@/components/BriefIntelImages';
import type { IntelImageItem, WhaleIntelContext } from '@/lib/intelImages';

export function BriefAnalysisPanel({
  brief,
  savedAnalyses,
  savedAnalysisAt,
  lastAiScanAt,
  lastConsensusAt,
  systemScanAt,
}: {
  brief: AiBriefPayload;
  savedAnalyses?: SavedAnalyses;
  savedAnalysisAt?: SavedAnalysisTimes;
  lastAiScanAt?: string | null;
  lastConsensusAt?: string | null;
  systemScanAt?: string | null;
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
    <>
      <BriefIntelImages ticker={brief.ticker} onIntelChange={handleIntelChange} />
      <AiBriefAnalysis
        brief={brief}
        savedAnalyses={savedAnalyses}
        savedAnalysisAt={savedAnalysisAt}
        lastAiScanAt={lastAiScanAt}
        lastConsensusAt={lastConsensusAt}
        systemScanAt={systemScanAt}
        whaleIntel={whaleIntel}
        intelValidating={intelBusy}
      />
    </>
  );
}
