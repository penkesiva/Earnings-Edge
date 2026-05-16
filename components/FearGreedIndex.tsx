import type { FearGreedComponent } from '@/lib/fearGreed';
import { getCnnFearGreed, fearGreedHue, bandForScore, tapeMoodFromFng } from '@/lib/fearGreed';

function ComponentRow({ c }: { c: FearGreedComponent }) {
  const h = fearGreedHue(c.score);
  const pct = Math.min(100, Math.max(0, c.score));

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px]">
        <span className="text-fg-muted flex-1 min-w-[140px]">{c.label}</span>
        <span className="font-mono tabular-nums text-fg shrink-0">{c.score}</span>
        <span className="text-fg-dim capitalize shrink-0 text-right w-[100px] sm:w-[120px] truncate">
          {c.rating}
        </span>
      </div>
      <div className="h-1 rounded-sm bg-bg border border-border-subtle overflow-hidden">
        <div
          className="h-full rounded-sm"
          style={{
            width: `${pct}%`,
            backgroundColor: `hsl(${h} 60% 44%)`,
          }}
        />
      </div>
    </div>
  );
}

function GranularBreakdown({ components }: { components: FearGreedComponent[] }) {
  if (!components.length) return null;

  return (
    <details className="mt-4 border-t border-border pt-3 group">
      <summary className="cursor-pointer text-[10px] text-fg-muted tracking-widest uppercase select-none list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90 text-fg-subtle">
          ▸
        </span>
        CNN inputs (9 signals)
      </summary>
      <p className="text-[10px] text-fg-dim mt-2 mb-3 leading-snug">
        Each row is 0–100 with its own fear/greed label — these roll up into the headline composite
        above.
      </p>
      <div className="space-y-3">
        {components.map(c => (
          <ComponentRow key={c.id} c={c} />
        ))}
      </div>
    </details>
  );
}

function MoodStrip({ score }: { score: number }) {
  const t = tapeMoodFromFng(score);
  const border =
    t.mood === 'green'
      ? 'border-l-signal-buy'
      : t.mood === 'red'
        ? 'border-l-signal-sell'
        : 'border-l-signal-watch';
  const labelColor =
    t.mood === 'green'
      ? 'text-signal-buy'
      : t.mood === 'red'
        ? 'text-signal-sell'
        : 'text-signal-watch';

  return (
    <div className={`mb-4 pl-3 border-l-[3px] ${border} bg-bg py-3 pr-3 border-y border-border`}>
      <div className="text-[10px] text-fg-muted tracking-widest uppercase mb-1">
        Market sentiment (rolling)
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`text-lg font-bold tracking-wide ${labelColor}`}>{t.label}</span>
        <span className="text-[11px] text-fg-dim">(CNN F&amp;G {score})</span>
      </div>
      <p className="text-[11px] text-fg-muted mt-1 leading-snug max-w-sm">{t.blurb}</p>
    </div>
  );
}

export function FearGreedIndexSkeleton() {
  return (
    <div className="border border-border bg-bg-elevated px-4 py-3 animate-pulse">
      <div className="h-12 w-full bg-border rounded mb-3" />
      <div className="h-2.5 w-36 bg-border rounded mb-3" />
      <div className="h-9 w-28 bg-border rounded mb-2" />
      <div className="h-2 w-full bg-border rounded" />
    </div>
  );
}

function Gauge({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const hue = fearGreedHue(score);
  const labelLeft = 'FEAR';
  const labelRight = 'GREED';

  return (
    <div className="mt-2">
      <div className="flex justify-between text-[10px] text-fg-dim tracking-widest uppercase mb-1">
        <span>{labelLeft}</span>
        <span>{labelRight}</span>
      </div>
      <div className="h-2 rounded-sm bg-bg border border-border overflow-hidden">
        <div
          className="h-full rounded-sm transition-[width] duration-300"
          style={{
            width: `${pct}%`,
            backgroundColor: `hsl(${hue} 70% 45%)`,
          }}
        />
      </div>
    </div>
  );
}

export async function FearGreedIndex() {
  const data = await getCnnFearGreed();

  if (!data) {
    return (
      <div className="border border-border bg-bg-elevated px-4 py-3 text-sm text-fg-subtle">
        <span className="text-xs tracking-widest uppercase text-fg-muted">
          Fear &amp; Greed
        </span>
        <p className="text-xs mt-1 text-fg-dim">
          Index unavailable — can&apos;t derive <span className="text-fg-subtle">Green / Sideways / Red</span>{' '}
          until this loads.
        </p>
      </div>
    );
  }

  const hue = fearGreedHue(data.score);
  const band = bandForScore(data.score);

  return (
    <div className="border border-border bg-bg-elevated px-4 py-3">
      <MoodStrip score={data.score} />
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <div className="text-xs text-fg-muted tracking-widest uppercase">
            CNN Fear &amp; Greed
          </div>
          <div className="flex items-baseline gap-2 mt-1 flex-wrap">
            <span
              className="text-3xl font-bold tabular-nums"
              style={{ color: `hsl(${hue} 65% 60%)` }}
            >
              {data.score}
            </span>
            <span className="text-sm text-fg font-semibold">{band.label}</span>
          </div>
          <p className="text-[11px] text-fg-muted mt-2 leading-relaxed max-w-[300px]">
            <span className="text-fg-dim">Typical </span>
            <span className="text-fg">{band.label}</span>
            <span className="text-fg-dim"> range on CNN&apos;s index is </span>
            <span className="text-fg tabular-nums">
              {band.min}–{band.max}
            </span>
            <span className="text-fg-dim"> (full scale </span>
            <span className="text-fg-subtle tabular-nums">0–100</span>
            <span className="text-fg-dim">).</span>
          </p>
          {(data.previousClose != null ||
            data.previous1Week != null ||
            data.previous1Month != null ||
            data.previous1Year != null) && (
            <div className="text-[10px] text-fg-dim mt-2 font-mono space-y-0.5">
              {data.previousClose != null && (
                <div>
                  Prior composite close: {Math.round(data.previousClose * 10) / 10}
                </div>
              )}
              {(data.previous1Week != null ||
                data.previous1Month != null ||
                data.previous1Year != null) && (
                <div className="text-fg-muted">
                  {data.previous1Week != null && (
                    <span>1w {data.previous1Week.toFixed(1)}</span>
                  )}
                  {data.previous1Month != null && (
                    <span>
                      {data.previous1Week != null ? ' · ' : ''}1m{' '}
                      {data.previous1Month.toFixed(1)}
                    </span>
                  )}
                  {data.previous1Year != null && (
                    <span>
                      {(data.previous1Week != null || data.previous1Month != null)
                        ? ' · '
                        : ''}
                      1y {data.previous1Year.toFixed(1)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <a
          href="https://www.cnn.com/markets/fear-and-greed"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-fg-dim hover:text-fg-subtle tracking-widest uppercase shrink-0"
        >
          CNN →
        </a>
      </div>
      <Gauge score={data.score} />

      <GranularBreakdown components={data.components} />
    </div>
  );
}
