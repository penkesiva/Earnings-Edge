import { PredictMarketPanel } from '@/components/predictMarket/PredictMarketPanel';
import { loadPredictMarketDashboard } from '@/lib/predictMarketPageActions';

export const dynamic = 'force-dynamic';

export default async function PredictMarketPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const data = await loadPredictMarketDashboard(searchParams.month);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
          <span className="page-chevron">›</span> PREDICTMARKET
        </h1>
        <p className="text-sm text-fg-subtle">
          SPX research, validation, and learning — predictions only, no auto-execution
        </p>
      </div>
      <PredictMarketPanel data={data} />
    </div>
  );
}
