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

  const prompt = `You validate earnings-trading screenshots for ticker ${ticker}.

For EACH attached image (in order), return one JSON object in the "images" array:
- id: echo the image id I provide
- ticker_match: true ONLY if the screenshot is primarily about ${ticker} (company name on same company is OK)
- detected_ticker: ticker symbol visible in image, or null
- source_hint: short label e.g. "Unusual Whales", "SpotGamma", "X/Twitter", "Discord", "Unknown"
- extracted_intel: ONE short plain line (max 120 chars). No Vol/OI, no ratios, no paragraphs.
  Format exactly one of:
  • "CALLS side · [expiry] $strikeC, $strikeC" (dominant call flow)
  • "PUTS side · [expiry] $strikeP, $strikeP" (dominant put flow)
  • "NEUTRAL · [expiry] calls $strikeC puts $strikeP" (mixed or balanced)
  Use top 1–3 strikes only. Expiry as shown (e.g. Jun 05, Jul 17). Example: "CALLS side · Jun 05 $240C, $260C · Jul 17 $250C"
- reject_reason: if ticker_match is false, one short reason; else null

Respond with JSON ONLY:
{"images":[{"id":"...","ticker_match":true,"detected_ticker":"${ticker}","source_hint":"...","extracted_intel":"...","reject_reason":null}]}`;

  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
    { text: prompt },
  ];

  for (const img of images) {
    parts.push({
      text: `\n--- image id: ${img.id ?? 'unknown'} ---`,
    });
    parts.push({
      inline_data: {
        mime_type: img.mimeType,
        data: img.base64.replace(/^data:[^;]+;base64,/, ''),
      },
    });
  }

  const upstream = await fetch(geminiGenerateContentUrl(GEMINI_VISION_OCR_MODEL, key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        temperature: 0,
      },
    }),
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return NextResponse.json(
      { error: parseGeminiHttpError(err, 'Screenshot validation failed') },
      { status: 502 },
    );
  }

  const json = await upstream.json();
  const rawText =
    (json.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined)?.trim() ?? '';

  let parsed: { images?: GeminiImageResult[] };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return NextResponse.json(
      { error: 'Gemini returned invalid JSON', raw: rawText.slice(0, 200) },
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
