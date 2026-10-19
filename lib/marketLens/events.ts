/**
 * Curated macro prints. Morning reports block new entries until 10:00 ET.
 * FOMC blocks new entries from 1:45 PM ET and flattens an open paper trade.
 * This is a date list, not a forecast of the number.
 */

export type MacroKind = 'morning_print' | 'fomc';

export type MacroEvent = {
  date: string;
  kind: MacroKind;
  name: string;
};

export const MACRO_EVENTS: MacroEvent[] = [
  { date: '2026-10-02', kind: 'morning_print', name: 'Jobs' },
  { date: '2026-10-14', kind: 'morning_print', name: 'CPI' },
  { date: '2026-10-15', kind: 'morning_print', name: 'PPI and retail sales' },
  { date: '2026-10-28', kind: 'fomc', name: 'FOMC decision' },
  { date: '2026-10-29', kind: 'morning_print', name: 'GDP and PCE' },
  { date: '2026-11-06', kind: 'morning_print', name: 'Jobs' },
  { date: '2026-11-10', kind: 'morning_print', name: 'CPI' },
  { date: '2026-11-13', kind: 'morning_print', name: 'PPI' },
  { date: '2026-11-17', kind: 'morning_print', name: 'Retail sales' },
  { date: '2026-11-25', kind: 'morning_print', name: 'GDP and PCE' },
  { date: '2026-12-09', kind: 'fomc', name: 'FOMC decision' },
];

export function macroEventOn(sessionDate: string): MacroEvent | null {
  return MACRO_EVENTS.find(e => e.date === sessionDate) ?? null;
}
