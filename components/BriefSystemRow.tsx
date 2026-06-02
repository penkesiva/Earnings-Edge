import type { ReactNode } from 'react';

function roundStrike(price: number): number {
  if (price < 25) return Math.round(price * 2) / 2;
  if (price < 200) return Math.round(price);
  return Math.round(price / 5) * 5;
}

/** Quant system lean + direction take — shown after Final Verdict on brief page. */
export function BriefSystemRow({
  compositeScore,
  finalAction,
  ivRank,
  expectedMovePct,
  expectedMoveDollar,
  spot,
  preferredExpiry,
  screamDirection,
  screamScore,
}: {
  compositeScore: number;
  finalAction: string | null;
  ivRank: number | null;
  expectedMovePct: number | null;
  expectedMoveDollar: number | null;
  spot: number | null;
  preferredExpiry: string | null;
  screamDirection: string | null;
  screamScore: number | null;
}) {
  const beatLabel =
    compositeScore >= 65 ? 'LIKELY' :
    compositeScore >= 50 ? 'POSSIBLE' :
    compositeScore >= 35 ? 'UNLIKELY' : 'LOW ODDS';

  const bullishActions = new Set([
    'LONG_CALL', 'CALL_DEBIT_SPREAD', 'PUT_CREDIT_SPREAD', 'BULLISH_WATCH',
    'SKIP_ASYMMETRIC_UPSIDE_RISK',
  ]);
  const bearishActions = new Set([
    'LONG_PUT', 'PUT_DEBIT_SPREAD', 'CALL_CREDIT_SPREAD', 'BEARISH_WATCH',
    'SKIP_ASYMMETRIC_DOWNSIDE_RISK',
  ]);

  const [leanLabel, leanCls] =
    finalAction && bullishActions.has(finalAction) ? ['BULLISH ▲', 'text-signal-buy'] :
    finalAction && bearishActions.has(finalAction) ? ['BEARISH ▼', 'text-signal-sell'] :
    finalAction === 'IRON_CONDOR' ? ['NEUTRAL ↔', 'text-signal-watch'] :
    finalAction === 'SKIP_CONFLICT' ? ['CONFLICTED', 'text-fg-muted'] :
    ['UNCLEAR', 'text-fg-dim'];

  const isBullish = finalAction && bullishActions.has(finalAction);
  const isBearish = finalAction && bearishActions.has(finalAction);
  const isNeutral = finalAction === 'IRON_CONDOR';
  const isLongCall = finalAction === 'LONG_CALL';
  const isLongPut = finalAction === 'LONG_PUT';

  const movePctStr = expectedMovePct ? `±${expectedMovePct.toFixed(1)}%` : null;
  const moveDolStr = expectedMoveDollar ? `≈$${expectedMoveDollar.toFixed(2)}` : null;
  const moveStr = moveDolStr && movePctStr ? `${moveDolStr} (${movePctStr})` : movePctStr ?? null;

  const ivr = ivRank;
  const screamNote =
    screamScore && screamScore >= 4 && screamDirection &&
    screamDirection !== 'none' && screamDirection !== 'mixed'
      ? ` · ${screamScore}/5 ${screamDirection} chain`
      : '';
  const ivNote =
    ivr === null ? '' :
    ivr >= 80 ? ' · Extreme IV — sell premium over buying' :
    ivr >= 60 ? ' · High IV — spreads over naked' :
    '';

  let directionTake: string;
  let directionCls: string;
  if (isBullish) {
    directionTake = `Likely UP${moveStr ? ` ${moveStr}` : ''}${screamNote}${ivNote}`;
    directionCls = 'text-signal-buy';
  } else if (isBearish) {
    directionTake = `Likely DOWN${moveStr ? ` ${moveStr}` : ''}${screamNote}${ivNote}`;
    directionCls = 'text-signal-sell';
  } else if (isNeutral) {
    directionTake = `Contained${moveStr ? ` ${moveStr}` : ''} — vol crush expected${ivNote}`;
    directionCls = 'text-signal-watch';
  } else {
    directionTake = `Direction unclear${moveStr ? ` — market pricing ${moveStr}` : ''}${ivNote}`;
    directionCls = 'text-fg-muted';
  }

  let tensionNote: string | null = null;
  if (isBearish && compositeScore >= 65) {
    tensionNote = `Beat ${beatLabel} but chain bearish — classic sell-the-news setup`;
  } else if (isBullish && compositeScore < 40) {
    tensionNote = `Beat ${beatLabel} but chain bullish — buy-the-rumor momentum play`;
  } else if (isNeutral && compositeScore >= 65) {
    tensionNote = `Beat ${beatLabel} — IV crush likely to offset any directional move`;
  }

  let nakedOptionLine: ReactNode = null;
  if ((isLongCall || isLongPut) && spot !== null && preferredExpiry) {
    const atmStrike = roundStrike(spot);
    const otmStrike = isLongCall
      ? roundStrike(spot + (expectedMoveDollar ?? spot * 0.05) * 0.5)
      : roundStrike(spot - (expectedMoveDollar ?? spot * 0.05) * 0.5);
    const type = isLongCall ? 'CALL' : 'PUT';
    const typeCls = isLongCall ? 'text-signal-buy' : 'text-signal-sell';
    nakedOptionLine = (
      <div className={`font-medium ${typeCls}`}>
        Buy: <span className="font-bold">${atmStrike} {type}</span>{' '}
        <span className="text-fg-dim">exp {preferredExpiry}</span>
        <span className="text-fg-dim"> · OTM alt: </span>
        <span className="font-bold">${otmStrike} {type}</span>
        <span className="text-fg-dim"> (higher leverage, smaller size)</span>
      </div>
    );
  }

  return (
    <section className="border border-border-subtle bg-bg-elevated/40 px-3 py-3 sm:px-4 text-xs space-y-1.5">
      <div className="text-[10px] tracking-widest text-fg-subtle">SYSTEM</div>
      <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
        <span className="text-fg-dim tracking-widest shrink-0">System</span>
        <span className={`font-semibold ${leanCls}`}>{leanLabel}</span>
      </div>
      <p className={`leading-relaxed ${directionCls}`}>{directionTake}</p>
      <a
        href="#news-sentiment"
        className="inline-block text-fg-dim hover:text-fg-subtle underline-offset-2 hover:underline"
      >
        News ↓
      </a>
      {tensionNote && <div className="text-fg-dim italic">{tensionNote}</div>}
      {nakedOptionLine}
    </section>
  );
}
