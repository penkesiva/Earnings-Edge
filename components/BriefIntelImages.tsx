'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IntelImageItem, WhaleIntelContext } from '@/lib/intelImages';
import {
  ACCEPTED_INTEL_MIME,
  MAX_INTEL_IMAGES,
  buildWhaleIntelSummary,
  readImageFile,
} from '@/lib/intelImages';

export function BriefIntelImages({
  ticker,
  onIntelChange,
}: {
  ticker: string;
  onIntelChange: (intel: WhaleIntelContext | null, items: IntelImageItem[]) => void;
}) {
  const [items, setItems] = useState<IntelImageItem[]>([]);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const intel = useMemo(() => buildWhaleIntelSummary(items), [items]);
  const matched = items.filter(i => i.status === 'matched');
  const rejected = items.filter(i => i.status === 'rejected');
  const validating = items.some(i => i.status === 'validating');

  useEffect(() => {
    onIntelChange(intel, items);
  }, [intel, items, onIntelChange]);

  useEffect(() => {
    return () => {
      for (const item of items) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateOne = useCallback(
    async (item: IntelImageItem) => {
      setItems(prev =>
        prev.map(i => (i.id === item.id ? { ...i, status: 'validating' as const } : i)),
      );

      try {
        const res = await fetch('/api/internal/validate-intel-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker,
            images: [{ id: item.id, mimeType: item.mimeType, base64: item.base64 }],
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error ?? `Validation HTTP ${res.status}`);
        }

        const row = data.results?.[0] as {
          tickerMatch?: boolean;
          detectedTicker?: string | null;
          sourceHint?: string | null;
          extractedIntel?: string | null;
          rejectReason?: string | null;
        };

        setItems(prev =>
          prev.map(i =>
            i.id === item.id
              ? {
                  ...i,
                  status: row?.tickerMatch ? 'matched' : 'rejected',
                  detectedTicker: row?.detectedTicker ?? null,
                  sourceHint: row?.sourceHint ?? null,
                  extractedIntel: row?.extractedIntel ?? null,
                  rejectReason: row?.rejectReason ?? null,
                }
              : i,
          ),
        );
      } catch (e) {
        setItems(prev =>
          prev.map(i =>
            i.id === item.id
              ? {
                  ...i,
                  status: 'rejected' as const,
                  rejectReason: e instanceof Error ? e.message : 'Validation failed',
                }
              : i,
          ),
        );
      }
    },
    [ticker],
  );

  async function addFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setError('');

    const slots = MAX_INTEL_IMAGES - items.length;
    if (slots <= 0) {
      setError(`Max ${MAX_INTEL_IMAGES} screenshots per brief`);
      return;
    }

    const files = Array.from(fileList).slice(0, slots);

    for (const file of files) {
      try {
        const { base64, mimeType } = await readImageFile(file);
        const id = crypto.randomUUID();
        const previewUrl = URL.createObjectURL(file);
        const item: IntelImageItem = {
          id,
          previewUrl,
          mimeType,
          base64,
          status: 'pending',
        };
        setItems(prev => [...prev, item]);
        void validateOne(item);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not add image');
      }
    }

    if (inputRef.current) inputRef.current.value = '';
  }

  function removeItem(id: string) {
    setItems(prev => {
      const target = prev.find(i => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(i => i.id !== id);
    });
  }

  const sourceLabels = matched
    .map(i => i.sourceHint)
    .filter(Boolean)
    .slice(0, 3) as string[];

  return (
    <div className="mt-3 pt-3 border-t border-border-subtle">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-2">
        <span className="text-[10px] tracking-widest text-fg-subtle">WHALE / ANALYST INTEL</span>
        {items.length === 0 ? (
          <span className="text-[11px] text-fg-dim">No screenshots — optional for Scan All</span>
        ) : validating ? (
          <span className="text-[11px] text-signal-watch animate-pulse">Validating ticker…</span>
        ) : matched.length > 0 ? (
          <span className="text-[11px] text-signal-buy font-medium">
            {matched.length} ✓ {ticker}
            {sourceLabels.length ? ` · ${sourceLabels.join(', ')}` : ''}
          </span>
        ) : (
          <span className="text-[11px] text-signal-sell">No {ticker} matches yet</span>
        )}
        {rejected.length > 0 && (
          <span className="text-[11px] text-signal-sell">
            {rejected.length} rejected
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-2">
        {items.map(item => (
          <div
            key={item.id}
            className={`relative w-16 h-16 border overflow-hidden shrink-0 ${
              item.status === 'matched'
                ? 'border-signal-buy/50'
                : item.status === 'rejected'
                  ? 'border-signal-sell/50'
                  : 'border-border-subtle'
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.previewUrl}
              alt=""
              className="w-full h-full object-cover opacity-90"
            />
            <span
              className={`absolute bottom-0 inset-x-0 text-[8px] text-center py-0.5 font-bold tracking-wide ${
                item.status === 'matched'
                  ? 'bg-signal-buy/90 text-bg'
                  : item.status === 'rejected'
                    ? 'bg-signal-sell/90 text-white'
                    : 'bg-bg/80 text-fg-muted'
              }`}
            >
              {item.status === 'validating'
                ? '…'
                : item.status === 'matched'
                  ? '✓'
                  : item.status === 'rejected'
                    ? '✗'
                    : '·'}
            </span>
            <button
              type="button"
              onClick={() => removeItem(item.id)}
              className="absolute top-0 right-0 w-4 h-4 bg-bg/90 text-fg-dim text-[10px] leading-none hover:text-fg"
              aria-label="Remove screenshot"
            >
              ×
            </button>
          </div>
        ))}

        {items.length < MAX_INTEL_IMAGES && (
          items.length === 0 ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-full min-h-[2.75rem] px-4 border border-dashed border-border bg-bg-elevated text-[11px] font-bold tracking-widest text-fg-muted hover:border-signal-buy/60 hover:text-signal-buy hover:bg-bg-hover transition-colors touch-target"
              aria-label="Add whale or analyst screenshot"
            >
              + ADD SCREENSHOT
            </button>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-16 h-16 border border-dashed border-border bg-bg-elevated text-[10px] font-bold tracking-widest text-fg-muted hover:border-signal-buy/60 hover:text-signal-buy hover:bg-bg-hover shrink-0 transition-colors"
              aria-label="Add whale or analyst screenshot"
            >
              + ADD
            </button>
          )
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_INTEL_MIME.join(',')}
          multiple
          className="hidden"
          onChange={e => addFiles(e.target.files)}
        />
      </div>

      {rejected.length > 0 && (
        <ul className="mt-2 space-y-1 text-[10px] text-signal-sell">
          {rejected.map(item => (
            <li key={item.id}>
              Wrong ticker{item.detectedTicker ? ` (${item.detectedTicker})` : ''}
              {item.rejectReason ? ` — ${item.rejectReason}` : ''}
            </li>
          ))}
        </ul>
      )}

      {intel?.summary && (
        <p className="mt-2 text-[11px] text-fg-muted leading-snug line-clamp-3" title={intel.summary}>
          OCR: {intel.summary.replace(/\n/g, ' · ')}
        </p>
      )}

      {error && <p className="mt-2 text-[11px] text-signal-sell">{error}</p>}

      <p className="mt-2 text-[10px] text-fg-dim">
        Paste whale or analyst screenshots — Gemini checks {ticker} match + OCR. Not saved; used on Scan All only.
      </p>
    </div>
  );
}
