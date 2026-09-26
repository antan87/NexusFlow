import { MessagesSquare } from 'lucide-react';
import { useFloatingChat } from './floatingChatStore.js';
import { cn } from '../../lib/utils.js';

export function FloatingChatLauncher() {
  const { isOpen, isMinimized, openTabs, open } = useFloatingChat();

  // If the full window is already open and not minimized, don't show the redundant floating trigger button
  if (isOpen && !isMinimized) {
    return null;
  }

  // If minimized, FloatingChatModal already renders its sleek pill
  if (isMinimized) {
    return null;
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 animate-fade-in">
      <button
        onClick={() => open()}
        className={cn(
          'group relative flex items-center justify-center gap-2 h-11 px-4 rounded-full',
          'bg-primary text-primary-foreground shadow-lg shadow-primary/25',
          'hover:scale-105 hover:shadow-xl hover:shadow-primary/35 active:scale-95',
          'transition-all duration-200 cursor-pointer border border-primary/20',
        )}
        title="Open CLI Chat launcher"
        aria-label="Open CLI Chat launcher"
      >
        <MessagesSquare className="size-4" aria-hidden="true" /><span className="text-xs font-medium">CLI Chat</span>

        {openTabs.length > 0 && (
          <span className="absolute -top-1 -right-1 size-5 rounded-full bg-emerald-500 text-white text-[10px] font-bold grid place-items-center shadow-md border-2 border-background">
            {openTabs.length}
          </span>
        )}
      </button>
    </div>
  );
}
