import type { ReactNode } from 'react';

/** Section title row — stacks controls under title on mobile, inline on desktop. */
export function SectionHeader({
  title,
  children,
}: {
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6">
      {title}
      {children ? (
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap shrink-0">
          {children}
        </div>
      ) : null}
    </div>
  );
}
