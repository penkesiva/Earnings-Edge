/** User-facing labels for PredictMarket timeline and snapshot kinds. */

export const PM_TIMELINE_STEPS = [
  { key: 'night', label: 'Night forecast (LLM)', timePt: '9:00 PM PT (prior evening)' },
  { key: 'premarket', label: 'Premarket forecast (LLM)', timePt: '6:10 AM PT' },
  { key: 'open', label: 'Open thesis check', timePt: '6:30 AM PT' },
  { key: 'entry', label: 'Entry signal', timePt: '6:31–7:00 AM PT' },
  { key: 'validate_7am', label: 'First intraday check', timePt: '7:00 AM PT' },
  { key: 'validate_price_2h', label: '2-hour price target ($ HIT)', timePt: '8:30 AM PT window · cron ~8:31 AM PT' },
  { key: 'validate_10am', label: 'Midday check', timePt: '10:00 AM PT' },
  { key: 'grade', label: 'Morning thesis grade (primary)', timePt: 'After 7 AM check · scored at 1:15 PM PT' },
  { key: 'eod_reference', label: 'Full session close (reference)', timePt: '1:15 PM PT' },
] as const;

export const SNAPSHOT_KIND_LABEL: Record<string, string> = {
  NIGHT_INPUT: 'Market data saved before night forecast',
  PREMARKET_INPUT: 'Market data saved before premarket forecast',
  OPEN: 'Market data at open (used for thesis check)',
  ENTRY_WINDOW: 'Market data during entry window',
  VALIDATION_7AM: 'Market data at 7 AM check',
  VALIDATION_10AM: 'Market data at 10 AM check',
  CLOSE: 'Market data near close',
};

export function snapshotKindLabel(kind: string): string {
  return SNAPSHOT_KIND_LABEL[kind] ?? `Market data (${kind})`;
}
