import { formatResponseTime } from '@/lib/aiScanCooldown';

/** Bottom-right timestamp for when an AI response completed. */
export function ResponseTimeStamp({
  at,
  className = '',
}: {
  at: string | null | undefined;
  className?: string;
}) {
  if (!at?.trim()) return null;
  const label = formatResponseTime(at);
  if (!label) return null;

  return (
    <time
      dateTime={at}
      title={at}
      className={`text-[10px] text-fg-dim tabular-nums font-mono ${className}`}
    >
      {label}
    </time>
  );
}
