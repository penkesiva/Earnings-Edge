/**
 * Scan All UI labels (client-safe). Defaults match lib/llmModels.ts and geminiModels.ts.
 * If you override models via env on the server, these strings may be slightly out of date.
 */

export const SCAN_ALL_PROVIDER_LABELS = {
  openai: {
    long: 'GPT-5.5 ANALYSIS',
    short: 'GPT-5.5',
  },
  gemini: {
    long: 'GEMINI 3.1 PRO ANALYSIS',
    short: 'GEMINI',
  },
  claude: {
    long: 'CLAUDE OPUS 4.7 ANALYSIS',
    short: 'CLAUDE',
  },
} as const;

/** Shown near final consensus when synthesis uses GPT-6 Astra. */
export const SYNTHESIS_MODEL_UI_LABEL = 'GPT-6 ASTRA';
