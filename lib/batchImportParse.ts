/** Strip leading "1. ", "2) ", "3 - ", etc. from a pasted schedule line. */
export function stripListPrefix(line: string): string {
  return line.trim().replace(/^\s*\d+(?:\s*[\.\)\:\-]\s*|\s+)/, '');
}

/** US equity ticker (1–5 letters, optional .X class e.g. BRK.B). */
export function parseTickerToken(raw: string): string | null {
  const s = stripListPrefix(raw.trim()).toUpperCase();
  const m = s.match(/^([A-Z][A-Z0-9]{0,4}(?:\.[A-Z])?)/);
  return m ? m[1] : null;
}

/**
 * Fuzzy line parser — handles pipe, tab, comma, or 2+ spaces as delimiters.
 * Leading list numbers (1. HD, 2) TGT, 3 - NVDA) are ignored.
 */
export function parseBatchLine(
  line: string,
  year: number
): { ticker: string; dateIso: string; timing: 'BMO' | 'AMC' | 'UNK' } | null {
  const trimmed = stripListPrefix(line);
  if (!trimmed || trimmed.startsWith('#')) return null;

  const parts = trimmed.split(/\s*[|,\t]\s*|\s{2,}/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const ticker = parseTickerToken(parts[0]);
  if (!ticker) return null;

  let timing: 'BMO' | 'AMC' | 'UNK' = 'UNK';
  for (const p of parts) {
    if (/\bAMC\b/i.test(p)) { timing = 'AMC'; break; }
    if (/\bBMO\b/i.test(p)) { timing = 'BMO'; break; }
  }

  const MONTH_MAP: Record<string, number> = {
    jan:1,feb:2,mar:3,apr:4,may:5,jun:6,
    jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
  };
  let dateIso: string | null = null;

  for (const p of parts) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) { dateIso = p; break; }

    const monthMatch = p.match(/([A-Za-z]{3,})\s+(\d{1,2})(?:\s+(\d{4}))?/)
      || p.match(/(\d{1,2})\s+([A-Za-z]{3,})(?:\s+(\d{4}))?/);
    if (monthMatch) {
      const isNumFirst = /^\d/.test(monthMatch[0]);
      const monthStr = isNumFirst ? monthMatch[2] : monthMatch[1];
      const dayStr   = isNumFirst ? monthMatch[1] : monthMatch[2];
      const yearStr  = monthMatch[3];
      const month = MONTH_MAP[monthStr.toLowerCase().slice(0, 3)];
      const day = parseInt(dayStr, 10);
      const y = yearStr ? parseInt(yearStr, 10) : year;
      if (month && day >= 1 && day <= 31) {
        dateIso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        break;
      }
    }
  }

  if (!dateIso) return null;
  return { ticker, dateIso, timing };
}
