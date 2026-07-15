import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn.js';

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className={cn('relative z-10 w-full max-w-lg rounded-lg border border-hairline bg-surface shadow-2xl animate-rise', className)}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
            <h3 className="font-display font-semibold text-content">{title}</h3>
            <button onClick={onClose} className="cursor-pointer text-content-faint hover:text-content" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
