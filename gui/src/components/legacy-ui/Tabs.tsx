import { cn } from './cn.js';

export interface TabItem {
  value: string;
  label: string;
}

export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('flex items-center gap-1 border-b border-hairline overflow-x-auto', className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors cursor-pointer',
              active ? 'text-content border-primary' : 'text-content-faint border-transparent hover:text-content',
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
