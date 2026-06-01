/** Ephemeral whale / analyst screenshot intel — not persisted to storage. */

export type IntelImageStatus = 'pending' | 'validating' | 'matched' | 'rejected';

export type IntelImageItem = {
  id: string;
  previewUrl: string;
  mimeType: string;
  /** Raw base64 without data-URL prefix. */
  base64: string;
  status: IntelImageStatus;
  detectedTicker?: string | null;
  sourceHint?: string | null;
  extractedIntel?: string | null;
  rejectReason?: string | null;
};

export type WhaleIntelContext = {
  summary: string;
  matchedCount: number;
  totalCount: number;
  items: Array<{
    sourceHint: string | null;
    extractedIntel: string;
  }>;
};

export const MAX_INTEL_IMAGES = 5;
export const MAX_INTEL_IMAGE_BYTES = 4 * 1024 * 1024;
export const ACCEPTED_INTEL_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function buildWhaleIntelSummary(items: IntelImageItem[]): WhaleIntelContext | null {
  const matched = items.filter(i => i.status === 'matched' && i.extractedIntel?.trim());
  if (!matched.length) return null;

  const parts = matched.map((item, idx) => {
    const src = item.sourceHint?.trim() || `Image ${idx + 1}`;
    const line = item.extractedIntel!.trim();
    return `${src}: ${line}`;
  });

  return {
    summary: parts.join('\n'),
    matchedCount: matched.length,
    totalCount: items.length,
    items: matched.map(item => ({
      sourceHint: item.sourceHint ?? null,
      extractedIntel: item.extractedIntel!.trim(),
    })),
  };
}

/** Text block for GPT / Claude / synthesis prompts. */
export function appendWhaleIntelSection(lines: string[], intel: WhaleIntelContext | null | undefined): void {
  if (!intel?.summary?.trim()) return;

  lines.push('## Whale / Analyst Screenshot Intel (simple flow read)');
  lines.push(
    `  ${intel.matchedCount} matched screenshot${intel.matchedCount === 1 ? '' : 's'} of ${intel.totalCount} attached`,
  );
  lines.push('');
  for (const item of intel.items) {
    const label = item.sourceHint ?? 'Screenshot';
    lines.push(`  ### ${label}`);
    lines.push(`  ${item.extractedIntel.replace(/\n/g, '\n  ')}`);
    lines.push('');
  }
  lines.push(
    '  Treat as supplemental flow/positioning context — weigh vs system chain and headlines; screenshots can be stale or wrong.',
  );
  lines.push('');
}

export async function readImageFile(
  file: File,
): Promise<{ base64: string; mimeType: string }> {
  if (!ACCEPTED_INTEL_MIME.includes(file.type as (typeof ACCEPTED_INTEL_MIME)[number])) {
    throw new Error('Use JPEG, PNG, or WebP screenshots only');
  }
  if (file.size > MAX_INTEL_IMAGE_BYTES) {
    throw new Error('Image must be under 4 MB');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] ?? '';
      if (!base64) {
        reject(new Error('Failed to read image'));
        return;
      }
      resolve({ base64, mimeType: file.type });
    };
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}
