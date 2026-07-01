import { useState, type ReactNode } from 'react';
import { cn } from './cn.js';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function Menu({
  trigger,
  items,
  align = 'right',
  label,
}: {
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center cursor-pointer"
      >
        {trigger}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className={cn(
              'absolute z-50 mt-1.5 min-w-48 rounded-lg border border-hairline bg-raised py-1 shadow-xl animate-fade-in',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            {items.map((it, i) => (
              <div key={i}>
                {it.danger && <div className="my-1 h-px bg-hairline" />}
                <button
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false);
                    it.onClick();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                    it.danger ? 'text-danger hover:bg-danger/10' : 'text-content-muted hover:bg-surface hover:text-content',
                  )}
                >
                  {it.icon}
                  {it.label}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
