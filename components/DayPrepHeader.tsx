import { formatDayHeader } from '@/lib/earningsDate';

/** Date label for home day sections — per-row Scan All replaces day PREP. */
export function DayPrepHeader({
  date,
  marketOpen = true,
}: {
  date: string;
  marketOpen?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-0.5 ${
        marketOpen ? '' : 'opacity-50'
      }`}
    >
      <div className="min-w-0">
        <h3
          className={`text-sm font-bold tracking-wide ${
            marketOpen ? 'text-fg' : 'text-fg-muted'
          }`}
        >
          {formatDayHeader(date)}
        </h3>
        {!marketOpen && (
          <p className="text-[10px] text-fg-dim tracking-widest mt-0.5">MARKET CLOSED</p>
        )}
        {marketOpen && (
          <p className="text-[10px] text-fg-dim tracking-wide mt-0.5 hidden sm:block">
            Scan All on each row — system + AI + verdict
          </p>
        )}
      </div>
    </div>
  );
}
