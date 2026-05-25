'use client';

import { DirectionIndicator } from '@/components/DirectionIndicator';
import type { ScanSignalChip } from '@/lib/scanSignalStrip';

export function ScanSignalStrip({ chips }: { chips: ScanSignalChip[] }) {
  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-fg-muted">
      {chips.map(chip => (
        <span key={chip.label} className="inline-flex items-center gap-1 font-medium">
          <span className="text-fg-dim">{chip.label}</span>
          {chip.detail && (
            <span className="font-mono tabular-nums text-fg-subtle">{chip.detail}</span>
          )}
          {chip.direction ? (
            <DirectionIndicator direction={chip.direction} />
          ) : (
            <span className="text-fg-dim font-bold" aria-label="No direction">
              —
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
