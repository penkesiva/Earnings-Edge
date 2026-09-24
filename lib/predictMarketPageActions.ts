'use server';

import { requireAuthSession } from '@/lib/authServer';
import { loadPredictMarketPageData } from '@/lib/predictMarket/loadPredictMarketPageData';

export async function loadPredictMarketDashboard() {
  const { sb } = await requireAuthSession();
  return loadPredictMarketPageData(sb);
}
