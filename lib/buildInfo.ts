/** Build metadata injected at compile time (see next.config.js). */
export type BuildInfo = {
  version: string;
  gitSha: string;
  builtAtIso: string;
  vercelEnv: string | null;
};

export function getBuildInfo(): BuildInfo {
  return {
    version: process.env.APP_VERSION ?? '0.0.0',
    gitSha: process.env.GIT_SHA ?? 'local',
    builtAtIso: process.env.BUILD_TIME ?? new Date(0).toISOString(),
    vercelEnv: process.env.VERCEL_ENV ?? null,
  };
}

/** Footer label, e.g. `v0.1.0 · b7b8279 · May 24, 2026 15:30 PT` */
export function formatBuildStamp(info: BuildInfo): string {
  const built = new Date(info.builtAtIso);
  const when = Number.isNaN(built.getTime())
    ? 'unknown'
    : built.toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

  return `v${info.version} · ${info.gitSha} · ${when} PT`;
}

export function buildEnvLabel(vercelEnv: string | null): string | null {
  if (!vercelEnv || vercelEnv === 'production') return null;
  return vercelEnv.toUpperCase();
}
