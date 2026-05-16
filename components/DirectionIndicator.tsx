'use client';

import { parseAiDirection, type Direction } from '@/lib/aiConsensus';

function IconUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M12 5l-5 6M12 5l5 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 19V5M12 19l-5-6M12 19l5-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconNeutral() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const STYLES: Record<Direction, { cls: string; title: string }> = {
  UP: { cls: 'direction-indicator direction-indicator--up', title: 'Direction: UP' },
  DOWN: { cls: 'direction-indicator direction-indicator--down', title: 'Direction: DOWN' },
  NEUTRAL: { cls: 'direction-indicator direction-indicator--neutral', title: 'Direction: NEUTRAL' },
};

export function DirectionIndicator({
  text,
  direction: directionProp,
}: {
  text?: string;
  direction?: Direction | null;
}) {
  const direction = directionProp ?? (text ? parseAiDirection(text) : null);
  if (!direction) return null;

  const { cls, title } = STYLES[direction];
  const Icon =
    direction === 'UP' ? IconUp : direction === 'DOWN' ? IconDown : IconNeutral;

  return (
    <span className={cls} title={title} aria-label={title}>
      <Icon />
    </span>
  );
}
