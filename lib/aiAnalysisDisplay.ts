/** Split model analysis into the lead "My final call:" line and the rest. */
export function splitAiFinalCall(text: string): {
  finalCall: string | null;
  rest: string;
} {
  const trimmed = text.trim();
  if (!trimmed) return { finalCall: null, rest: '' };

  const lines = trimmed.split('\n');
  const idx = lines.findIndex(l => /^My final call:/i.test(l.trim()));
  if (idx === -1) return { finalCall: null, rest: trimmed };

  const finalCall = lines[idx].trim();
  const rest = lines
    .slice(idx + 1)
    .join('\n')
    .trim();

  return { finalCall, rest };
}
