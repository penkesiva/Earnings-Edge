/** Central Gemini model IDs — keep in sync with Google AI model list. */

/** Screenshot ticker check + OCR (cheap, vision). Replaces deprecated gemini-2.0-flash. */
export const GEMINI_VISION_OCR_MODEL = 'gemini-2.5-flash';

/** Lightweight JSON/text classifiers (news tags, overhangs). */
export const GEMINI_FLASH_LITE_MODEL = 'gemini-2.5-flash-lite';

/** Scan All earnings analysis panel. Override: GEMINI_ANALYSIS_MODEL */
export const GEMINI_ANALYSIS_MODEL = envGeminiModel(
  'GEMINI_ANALYSIS_MODEL',
  'gemini-3.1-pro-preview',
);

function envGeminiModel(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

/** UI label for Scan All Gemini panel. */
export function geminiScanAllLabel(): string {
  const id = GEMINI_ANALYSIS_MODEL.toLowerCase();
  if (id.includes('3.8-flash')) return 'GEMINI 3.8 FLASH';
  if (id.includes('3.1-pro')) return 'GEMINI 3.1 PRO';
  if (id.includes('3-pro')) return 'GEMINI 3 PRO';
  return 'GEMINI';
}

export function geminiGenerateContentUrl(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

export function geminiStreamGenerateContentUrl(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
}

/** Parse Gemini text output — handles fences, trailing prose, and minor JSON glitches. */
export function parseGeminiJsonText<T = unknown>(raw: string): T {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Empty Gemini response');

  const attempts: string[] = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) attempts.push(fenced[1].trim());

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) attempts.push(trimmed.slice(start, end + 1));

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try next extraction
    }
  }

  throw new Error('Invalid JSON from Gemini');
}

/** Turn Gemini HTTP error bodies into a short user-facing string. */
export function parseGeminiHttpError(raw: string, fallback = 'Gemini request failed'): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  try {
    const outer = JSON.parse(trimmed) as { error?: string | { message?: string; code?: number } };
    if (typeof outer.error === 'string') return outer.error;
    if (outer.error?.message) return outer.error.message;
  } catch {
    // Sometimes the body is plain text
  }
  if (trimmed.length <= 180) return trimmed;
  return fallback;
}
