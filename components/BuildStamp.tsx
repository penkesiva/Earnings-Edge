import { buildEnvLabel, formatBuildStamp, getBuildInfo } from '@/lib/buildInfo';

export function BuildStamp() {
  const info = getBuildInfo();
  const envLabel = buildEnvLabel(info.vercelEnv);

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono tabular-nums text-[10px] text-fg-dim">
      {envLabel ? (
        <span className="text-signal-watch tracking-widest">{envLabel}</span>
      ) : null}
      <span>{formatBuildStamp(info)}</span>
    </span>
  );
}
