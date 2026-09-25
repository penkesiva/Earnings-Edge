'use server';

import { requireAuthSession } from '@/lib/authServer';
import { loadPredictMarketPageData } from '@/lib/predictMarket/loadPredictMarketPageData';
import { loadSessionCalendarMonth } from '@/lib/predictMarket/loadSessionCalendarMonth';

export async function loadPredictMarketDashboard(month?: string) {
  const { sb } = await requireAuthSession();
  const [data, calendar] = await Promise.all([
    loadPredictMarketPageData(sb),
    loadSessionCalendarMonth(sb, month),
  ]);
  return { ...data, calendar };
}
