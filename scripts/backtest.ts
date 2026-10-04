/**
 * Intraday backtest from the command line (same engine as the app).
 *
 * Run:
 *   npm run backtest -- --list
 *   npm run backtest -- <strategyId[,strategyId...]> <SYMBOL> [calendarDays=30] [budgetUsd=10000] [--trades]
 *
 * Examples:
 *   npm run backtest -- sam_ema11_50_v1 NVDA 30
 *   npm run backtest -- sam_ema50_200_v3,sam_ema11_50_v1,sam_ema11_200_v1 TSLA 30 10000 --trades
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import type { AlpacaAuth } from '../lib/alpaca';
import { runIntradayBacktest } from '../lib/intraday/backtest/runBacktest';
import { INTRADAY_STRATEGIES } from '../lib/intraday/strategies/registry';

const usd = (n: number) => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;

/** RTH ET and PT are always 3h apart. */
function etToPt(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const mins = (h * 60 + m - 180 + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function usage(): never {
  console.error(
    'Usage: npm run backtest -- <strategyId[,strategyId...]> <SYMBOL> [calendarDays=30] [budgetUsd=10000] [--trades]\n' +
      '       npm run backtest -- --list',
  );
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('--')));
  const pos = args.filter(a => !a.startsWith('--'));

  if (flags.has('--list')) {
    for (const s of INTRADAY_STRATEGIES) console.log(`${s.id.padEnd(32)} ${s.label}`);
    return;
  }

  const [strategyArg, symbolArg, daysArg = '30', budgetArg = '10000'] = pos;
  if (!strategyArg || !symbolArg) usage();

  const ids = strategyArg.split(',').map(s => s.trim()).filter(Boolean);
  const unknown = ids.filter(id => !INTRADAY_STRATEGIES.some(s => s.id === id));
  if (unknown.length) {
    console.error(`Unknown strategy: ${unknown.join(', ')}. Run with --list to see ids.`);
    process.exit(1);
  }

  const calendarDays = Number(daysArg);
  const budget = Number(budgetArg);
  if (!(calendarDays > 0) || !(budget > 0)) usage();

  const keyId = process.env.ALPACA_API_KEY?.trim();
  const secret = process.env.ALPACA_API_SECRET?.trim();
  if (!keyId || !secret) {
    console.error('Set ALPACA_API_KEY and ALPACA_API_SECRET in .env.local');
    process.exit(1);
  }
  const auth: AlpacaAuth = {
    keyId,
    secret,
    dataBaseUrl: process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets',
    environment: 'paper',
  };

  const symbol = symbolArg.toUpperCase();
  const summary: Record<string, string | number>[] = [];

  for (const id of ids) {
    const label = INTRADAY_STRATEGIES.find(s => s.id === id)?.label ?? id;
    console.log(`\n=== ${label} (${id}) · ${symbol} · ${calendarDays} days · $${budget} ===`);
    const t0 = Date.now();
    const r = await runIntradayBacktest({ symbol, calendarDays, effectiveBudgetUsd: budget, auth, strategyId: id });
    const m = r.metrics;

    console.log(
      `days ${r.daysWithData} | trades ${m.trades} | win rate ${m.winRate?.toFixed(0) ?? '-'}% | ` +
        `P&L ${usd(m.totalPnlUsd)} | PF ${m.profitFactor?.toFixed(2) ?? '-'} | ` +
        `max DD -$${m.maxDrawdownUsd.toFixed(2)} | avg hold ${m.avgHoldMinutes?.toFixed(0) ?? '-'}m ` +
        `(${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );

    const byExit: Record<string, { n: number; pnl: number }> = {};
    for (const t of r.trades) {
      const k = t.exitReason ?? 'unknown';
      byExit[k] = byExit[k] ?? { n: 0, pnl: 0 };
      byExit[k].n += 1;
      byExit[k].pnl += t.pnlUsd;
    }
    const fmt = (rows: [string, number, number][]) =>
      rows.map(([k, n, pnl]) => `${k} ${n} (${usd(pnl)})`).join(' | ') || '-';
    console.log('by setup:', fmt(Object.entries(m.bySetup).map(([k, v]) => [k, v.trades, v.pnlUsd])));
    console.log('by exit: ', fmt(Object.entries(byExit).map(([k, v]) => [k, v.n, v.pnl])));

    if (flags.has('--trades')) {
      for (const t of r.trades) {
        console.log(
          `  ${t.sessionDate} ${etToPt(t.entryTimeEt)}->${etToPt(t.exitTimeEt)} PT  ${t.setupType.padEnd(20)} ` +
            `${t.entryPrice.toFixed(2)} -> ${t.exitPrice.toFixed(2)}  ${usd(t.pnlUsd).padStart(9)}  ${t.exitReason ?? ''}`,
        );
      }
    }
    if (r.errors.length) console.log('errors:', r.errors);

    summary.push({
      strategy: id,
      trades: m.trades,
      winRate: m.winRate != null ? `${m.winRate.toFixed(0)}%` : '-',
      pnl: Number(m.totalPnlUsd.toFixed(2)),
      profitFactor: m.profitFactor != null ? Number(m.profitFactor.toFixed(2)) : '-',
      maxDD: Number(m.maxDrawdownUsd.toFixed(2)),
    });
  }

  if (ids.length > 1) {
    console.log('\n=== Comparison ===');
    console.table(summary);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
