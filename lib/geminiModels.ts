/** Central Gemini model IDs — keep in sync with Google AI model list. */

/** Screenshot ticker check + OCR (cheap, vision). Replaces deprecated gemini-2.0-flash. */
export const GEMINI_VISION_OCR_MODEL = 'gemini-2.5-flash';

/** Lightweight JSON/text classifiers (news tags, overhangs). */
export const GEMINI_FLASH_LITE_MODEL = 'gemini-2.5-flash-lite';

/** Scan All earnings analysis panel. */
export const GEMINI_ANALYSIS_MODEL = 'gemini-3.1-pro-preview';

export function geminiGenerateContentUrl(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

export function geminiStreamGenerateContentUrl(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
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
