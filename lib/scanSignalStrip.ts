import type { AiBriefPayload } from '@/components/AiBriefAnalysis';
import {
  parseAiDirection,
  systemDirectionFromBrief,
  type Direction,
} from '@/lib/aiConsensus';

export type ScanSignalChip = {
  label: string;
  detail?: string;
  direction: Direction | null;
};

const MODEL_LABELS = { openai: 'GPT', gemini: 'Gemini', claude: 'Claude' } as const;

function screamDirection(screamDirection: string | null): Direction | null {
  const d = screamDirection?.toLowerCase() ?? '';
  if (d.includes('bull')) return 'UP';
  if (d.includes('bear')) return 'DOWN';
  if (d.includes('mixed') || d.includes('neutral')) return 'NEUTRAL';
  return null;
}

function formatAction(action: string | null): string | undefined {
  if (!action) return undefined;
  return action.replace(/_/g, ' ').toLowerCase();
}

/** Compact top signals for the Scan All toolbar strip. */
export function buildScanSignalStrip(
  brief: AiBriefPayload,
  analyses: Partial<Record<'openai' | 'gemini' | 'claude', string>>,
): ScanSignalChip[] {
  const chips: ScanSignalChip[] = [];

  const screamScore = brief.scream_score ?? 0;
  chips.push({
    label: 'Scream',
    detail: `${screamScore}/5${brief.scream_qualifies ? ' ✓' : ''}`,
    direction: screamDirection(brief.scream_direction),
  });

  if (brief.iv_rank != null) {
    chips.push({
      label: 'IV',
      detail: `${Math.round(brief.iv_rank)}`,
      direction: null,
    });
  }

  const systemDir = systemDirectionFromBrief(brief);
  chips.push({
    label: 'System',
    detail: formatAction(brief.final_action),
    direction: systemDir,
  });

  for (const p of ['openai', 'gemini', 'claude'] as const) {
    const text = analyses[p];
    chips.push({
      label: MODEL_LABELS[p],
      direction: text?.trim() ? parseAiDirection(text) : null,
    });
  }

  return chips;
}
