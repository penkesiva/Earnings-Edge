import { formatDayHeader } from '@/lib/earningsDate';
import { PrepDateButton } from '@/components/PrepDateButton';

/** Date label (left) + PREP (right) — shared by home day sections. */
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
      </div>
      {marketOpen ? <PrepDateButton date={date} /> : null}
    </div>
  );
}
