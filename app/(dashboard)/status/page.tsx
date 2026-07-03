import { requireAuthSession } from '@/lib/authServer';
import { runSystemHealthChecks } from '@/lib/systemHealthCheck';
import { SystemStatusPanel } from '@/components/status/SystemStatusPanel';

export const dynamic = 'force-dynamic';

export default async function StatusPage() {
  const { sb, user } = await requireAuthSession();
  const report = await runSystemHealthChecks(sb, user.email ?? user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
          <span className="page-chevron">›</span> SYSTEM STATUS
        </h1>
        <p className="text-sm text-fg-subtle">
          Post-login health check — auth, database, env, and shipped features
        </p>
      </div>

      <SystemStatusPanel report={report} />
    </div>
  );
}
