import { AlertCircle, Check, Sparkles, X } from 'lucide-react';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number;
}

interface ToastStackProps {
  toasts: Toast[];
  onDismiss: (toastId: string) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-3 pointer-events-none max-w-md w-full">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start justify-between gap-3 px-4 py-3 rounded-xl border shadow-2xl transition-all duration-300 animate-slide-in ${
            toast.type === 'success'
              ? 'bg-[#062c1b]/95 border-emerald-800/80 text-emerald-100'
              : toast.type === 'error'
              ? 'bg-[#2c0e0e]/95 border-red-900/80 text-red-100'
              : 'bg-[#131926]/95 border-slate-800/80 text-slate-100'
          }`}
        >
          <div className="flex items-start gap-2.5 text-xs font-semibold flex-1">
            {toast.type === 'success' && <Check className="text-emerald-400 shrink-0 mt-0.5" size={16} />}
            {toast.type === 'error' && <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={16} />}
            {toast.type === 'info' && <Sparkles className="text-indigo-400 shrink-0 mt-0.5" size={16} />}
            <span className="whitespace-pre-line text-left leading-relaxed">{toast.message}</span>
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0 mt-0.5"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
