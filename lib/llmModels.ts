/**
 * Central LLM model IDs for Scan All, synthesis, and lightweight classifiers.
 * Override via env without code changes (see .env.example).
 */

function envModel(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

/** Scan All — OpenAI panel (streaming). */
export const OPENAI_SCAN_ALL_MODEL = envModel('OPENAI_SCAN_ALL_MODEL', 'gpt-5.5');

/** Final consensus verdict (non-streaming). Default: GPT-6 Astra trial. */
export const OPENAI_SYNTHESIS_MODEL = envModel('OPENAI_SYNTHESIS_MODEL', 'gpt-6-astra');

/** Scan All — Anthropic panel (streaming). */
export const CLAUDE_SCAN_ALL_MODEL = envModel('CLAUDE_SCAN_ALL_MODEL', 'claude-opus-4-7');

/** Cheap JSON/text classifiers (news tags, etc.). */
export const OPENAI_CLASSIFIER_MODEL = envModel('OPENAI_CLASSIFIER_MODEL', 'gpt-4o-mini');

/** PredictMarket forecasts (Responses API + web_search). */
export const OPENAI_PREDICTMARKET_MODEL = envModel('OPENAI_PREDICTMARKET_MODEL', 'gpt-5.5');

/** Human-readable labels for UI (match model family, not exact snapshot). */
export function openAiScanAllLabel(): string {
  return modelFamilyLabel(OPENAI_SCAN_ALL_MODEL, 'GPT');
}

export function openAiSynthesisLabel(): string {
  return modelFamilyLabel(OPENAI_SYNTHESIS_MODEL, 'GPT');
}

export function claudeScanAllLabel(): string {
  const m = CLAUDE_SCAN_ALL_MODEL.toLowerCase();
  if (m.includes('opus')) return 'CLAUDE OPUS';
  if (m.includes('sonnet')) return 'CLAUDE SONNET';
  return 'CLAUDE';
}

function modelFamilyLabel(modelId: string, prefix: string): string {
  const id = modelId.toLowerCase();
  if (id.includes('astra')) return `${prefix}-6 ASTRA`;
  if (id.includes('gpt-6')) return `${prefix}-6`;
  if (id.includes('gpt-5')) return `${prefix}-5.5`;
  if (id.includes('gpt-4')) return `${prefix}-4o`;
  return modelId.toUpperCase();
}
