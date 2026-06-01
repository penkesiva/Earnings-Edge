/**
 * POST /api/internal/validate-intel-images
 *
 * Gemini vision: verify screenshots match the brief ticker + OCR flow/levels.
 * Images are not stored — processed in memory only.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  GEMINI_VISION_OCR_MODEL,
  geminiGenerateContentUrl,
  parseGeminiHttpError,
  parseGeminiJsonText,
} from '@/lib/geminiModels';
import {
  ACCEPTED_INTEL_MIME,
  MAX_INTEL_IMAGES,
} from '@/lib/intelImages';

export const maxDuration = 60;

type ImageInput = { mimeType: string; base64: string; id?: string };

type GeminiImageResult = {
  id?: string;
  ticker_match?: boolean;
  detected_ticker?: string | null;
  source_hint?: string | null;
  extracted_intel?: string | null;
  reject_reason?: string | null;
};

function normalizeTicker(t: string): string {
  return t.trim().toUpperCase().replace(/[^A-Z0-9.]/g, '');
}

function tickersMatch(expected: string, detected: string | null | undefined): boolean {
  if (!detected) return false;
  const a = normalizeTicker(expected);
  const b = normalizeTicker(detected);
  if (!a || !b) return false;
  return a === b || b.includes(a) || a.includes(b);
}

function buildSystemPrompt(ticker: string): string {
  return `You validate earnings-trading screenshots for ticker ${ticker}.

For EACH attached image (in order), return one JSON object in the "images" array:
- id: echo the image id I provide
- ticker_match: true ONLY if the screenshot is primarily about ${ticker}
- detected_ticker: ticker symbol visible in image, or null
- source_hint: short label e.g. "Unusual Whales", "SpotGamma", "X/Twitter", "Unknown"
- extracted_intel: ONE short plain line (max 120 chars). No Vol/OI, no ratios, no paragraphs.
  Format exactly one of:
  • CALLS side | Jun 05 $240C, $260C | Jul 17 $250C  (dominant call flow)
  • PUTS side | Jun 05 $180P, $170P  (dominant put flow)
  • NEUTRAL | Jun 05 calls $240C puts $180P  (mixed or balanced)
  Use top 1-3 strikes only. Use pipe | between expiry groups. No double quotes inside this field.
- reject_reason: if ticker_match is false, one short reason; else null

Return ONLY valid JSON:
{"images":[{"id":"...","ticker_match":true,"detected_ticker":"${ticker}","source_hint":"Unusual Whales","extracted_intel":"CALLS side | Jun 05 $240C","reject_reason":null}]}`;
}

function buildContentParts(
  images: ImageInput[],
): Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> {
  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [];
  for (const img of images) {
    parts.push({ text: `Image id: ${img.id ?? 'unknown'}` });
    parts.push({
      inline_data: {
        mime_type: img.mimeType,
        data: img.base64.replace(/^data:[^;]+;base64,/, ''),
      },
    });
  }
  return parts;
}

async function callGeminiVision(
  key: string,
  ticker: string,
  images: ImageInput[],
): Promise<string> {
  const upstream = await fetch(geminiGenerateContentUrl(GEMINI_VISION_OCR_MODEL, key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: buildSystemPrompt(ticker) }] },
      contents: [{ parts: buildContentParts(images) }],
      generationConfig: {
        max_output_tokens: 1024,
        response_mime_type: 'application/json',
        temperature: 0,
      },
    }),
    cache: 'no-store',
  });

  if (!upstream.ok) {
    throw new Error(parseGeminiHttpError(await upstream.text(), 'Screenshot validation failed'));
  }

  const json = await upstream.json();
  const finishReason = json.candidates?.[0]?.finishReason as string | undefined;
  if (finishReason === 'MAX_TOKENS') {
    throw new Error('Screenshot validation response was truncated — try again');
  }

  return (
    (json.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined)?.trim() ?? ''
  );
}

function parseImageResults(rawText: string): { images?: GeminiImageResult[] } {
  if (!rawText) return { images: [] };
  try {
    return parseGeminiJsonText<{ images?: GeminiImageResult[] }>(rawText);
  } catch {
    return { images: [] };
  }
}

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 503 });
  }

  let body: { ticker?: string; images?: ImageInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ticker = body.ticker?.trim().toUpperCase();
  const images = body.images ?? [];

  if (!ticker) {
    return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  }
  if (!images.length || images.length > MAX_INTEL_IMAGES) {
    return NextResponse.json(
      { error: `Send 1–${MAX_INTEL_IMAGES} images` },
      { status: 400 },
    );
  }

  for (const img of images) {
    if (!img.base64?.trim() || !img.mimeType) {
      return NextResponse.json({ error: 'Each image needs mimeType and base64' }, { status: 400 });
    }
    if (!ACCEPTED_INTEL_MIME.includes(img.mimeType as (typeof ACCEPTED_INTEL_MIME)[number])) {
      return NextResponse.json({ error: `Unsupported mime type: ${img.mimeType}` }, { status: 400 });
    }
  }

  let rawText = '';
  try {
    rawText = await callGeminiVision(key, ticker, images);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Screenshot validation failed' },
      { status: 502 },
    );
  }

  let parsed = parseImageResults(rawText);
  if (!parsed.images?.length) {
    try {
      rawText = await callGeminiVision(key, ticker, images);
      parsed = parseImageResults(rawText);
    } catch {
      // keep first failure path below
    }
  }

  if (!parsed.images?.length) {
    return NextResponse.json(
      {
        error: 'Could not read screenshot — try again or use a clearer crop',
        raw: rawText.slice(0, 200),
      },
      { status: 502 },
    );
  }

  const results: Array<{
    id: string;
    tickerMatch: boolean;
    detectedTicker: string | null;
    sourceHint: string | null;
    extractedIntel: string | null;
    rejectReason: string | null;
  }> = [];

  for (let i = 0; i < images.length; i++) {
    const input = images[i];
    const row =
      parsed.images?.find(r => r.id && input.id && r.id === input.id) ??
      parsed.images?.[i];

    const detected = row?.detected_ticker?.trim().toUpperCase() ?? null;
    const modelMatch = row?.ticker_match === true;
    const tickerMatch = modelMatch || tickersMatch(ticker, detected);

    results.push({
      id: input.id ?? String(i),
      tickerMatch,
      detectedTicker: detected,
      sourceHint: row?.source_hint?.trim() ?? null,
      extractedIntel: row?.extracted_intel?.trim() ?? null,
      rejectReason: tickerMatch
        ? null
        : row?.reject_reason?.trim() ??
          (detected ? `Looks like ${detected}, not ${ticker}` : 'Ticker not found in screenshot'),
    });
  }

  return NextResponse.json({ ticker, model: GEMINI_VISION_OCR_MODEL, results });
}
