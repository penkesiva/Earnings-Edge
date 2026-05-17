import { formatDayHeader } from '@/lib/earningsDate';
import { PrepDateButton } from '@/components/PrepDateButton';

/** Date label (left) + PREP (right) — shared by home TODAY/TOMORROW and NEXT 7 DAYS. */
export function DayPrepHeader({ date }: { date: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-0.5">
      <h3 className="text-sm font-bold tracking-wide text-fg">{formatDayHeader(date)}</h3>
      <PrepDateButton date={date} />
    </div>
  );
}
