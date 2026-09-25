import { MAX_TRADING_BUDGET_USD, MIN_TRADING_BUDGET_USD } from '@/lib/intraday/config/defaults';

export type BudgetValidation =
  | { ok: true; budgetUsd: number; deployPct: number; effectiveUsd: number }
  | { ok: false; error: string };

export function validateTradingBudget(
  rawBudget: unknown,
  rawDeployPct: unknown,
): BudgetValidation {
  const budgetUsd = typeof rawBudget === 'number' ? rawBudget : Number(rawBudget);
  if (!Number.isFinite(budgetUsd)) {
    return { ok: false, error: 'Enter a valid trading budget (USD).' };
  }
  if (budgetUsd < MIN_TRADING_BUDGET_USD) {
    return { ok: false, error: `Budget must be at least $${MIN_TRADING_BUDGET_USD}.` };
  }
  if (budgetUsd > MAX_TRADING_BUDGET_USD) {
    return { ok: false, error: 'Budget is too large.' };
  }

  const deployPctRaw =
    rawDeployPct === undefined || rawDeployPct === null || rawDeployPct === ''
      ? 100
      : Number(rawDeployPct);
  if (!Number.isFinite(deployPctRaw)) {
    return { ok: false, error: 'Deploy % must be between 1 and 100.' };
  }
  const deployPct = Math.round(deployPctRaw);
  if (deployPct <= 0 || deployPct > 100) {
    return { ok: false, error: 'Deploy % must be between 1 and 100.' };
  }

  const effectiveUsd = (budgetUsd * deployPct) / 100;
  if (effectiveUsd < MIN_TRADING_BUDGET_USD / 10) {
    return { ok: false, error: 'Effective budget after deploy % is too small.' };
  }

  return { ok: true, budgetUsd: Math.round(budgetUsd * 100) / 100, deployPct, effectiveUsd };
}

/** Whole shares from effective USD budget at price (stocks only). */
export function sharesFromBudget(effectiveUsd: number, price: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(effectiveUsd) || effectiveUsd <= 0) return null;
  const shares = Math.floor(effectiveUsd / price);
  return shares >= 1 ? shares : null;
}

export function scaleShares(totalShares: number, pct: number): number {
  if (totalShares < 1) return 0;
  const part = Math.floor((totalShares * pct) / 100);
  return Math.max(1, Math.min(totalShares, part));
}
