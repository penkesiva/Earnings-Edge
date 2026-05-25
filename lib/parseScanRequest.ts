import type { AiBriefPayload } from '@/components/AiBriefAnalysis';

export type ScanRequestBody = {
  brief: AiBriefPayload;
  scan_run_id?: string;
};

export function parseScanRequestBody(raw: unknown): ScanRequestBody | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Invalid JSON' };

  const body = raw as Record<string, unknown>;
  const scanRunId =
    typeof body.scan_run_id === 'string' ? body.scan_run_id : undefined;

  if (body.brief && typeof body.brief === 'object') {
    const brief = body.brief as AiBriefPayload;
    if (!brief.brief_id || !brief.ticker) return { error: 'Invalid brief payload' };
    return { brief, scan_run_id: scanRunId };
  }

  if (typeof body.brief_id === 'string' && typeof body.ticker === 'string') {
    return { brief: body as AiBriefPayload, scan_run_id: scanRunId };
  }

  return { error: 'brief required' };
}
