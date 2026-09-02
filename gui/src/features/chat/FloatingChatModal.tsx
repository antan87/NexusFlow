import { useState, useRef, useCallback, useMemo } from 'react';
import {
  Bot,
  X,
  Minus,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  GripHorizontal,
  FolderGit2,
  MessageSquare,
} from 'lucide-react';
import { BsOpenai } from 'react-icons/bs';
import { SiClaude, SiGithubcopilot } from 'react-icons/si';
import { AntigravityIcon } from '../../components/icons/AntigravityIcon.js';
import { Button } from '../../components/ui/button.js';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../../components/ui/menu.js';
import { cn } from '../../lib/utils.js';
import type { Feature } from '../../types.js';
import { AgentChat } from './AgentChat.js';
import { useFloatingChat } from './floatingChatStore.js';
import { loadChatStore } from './chatStore.js';
import { providerForAssistant } from './chatLaunch.js';

interface FloatingChatModalProps {
  workspaces: Feature[];
}

function getWorkspaceChatIcon(ws?: Feature) {
  if (!ws) return <FolderGit2 className="size-3 text-muted-foreground shrink-0" />;
  try {
    const chatStore = loadChatStore(ws.branchName);
    const provider = chatStore.providerId || providerForAssistant(ws.assistants?.[0]) || 'antigravity-cli';
    if (provider.startsWith('claude')) return <SiClaude className="size-3 text-[#D97757] shrink-0" />;
    if (provider.startsWith('codex')) return <BsOpenai className="size-3 text-foreground shrink-0" />;
    if (provider.startsWith('copilot')) return <SiGithubcopilot className="size-3 text-blue-400 shrink-0" />;
    if (provider.startsWith('antigravity')) return <AntigravityIcon className="size-3.5 shrink-0" />;
  } catch {}
  return <FolderGit2 className="size-3 text-muted-foreground shrink-0" />;
}

export function FloatingChatModal({ workspaces }: FloatingChatModalProps) {
  const {
    isOpen,
    isMinimized,
    isMaximized,
    openTabs,
    activeTab,
    position,
    size,
    close,
    minimize,
    restore,
    toggleMaximize,
    addTab,
    removeTab,
    setActiveTab,
    setPosition,
    setSize,
  } = useFloatingChat();

  const [searchQuery, setSearchQuery] = useState('');
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Map open branch names to workspace objects
  const workspaceMap = useMemo(() => {
    return new Map(workspaces.map((w) => [w.branchName, w]));
  }, [workspaces]);

  const activeWorkspace = activeTab ? workspaceMap.get(activeTab) : undefined;

  const filteredWorkspaces = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter(
      (w) => w.branchName.toLowerCase().includes(q) || (w.description && w.description.toLowerCase().includes(q)),
    );
  }, [workspaces, searchQuery]);

  // Handle Dragging
  const handleDragStart = useCallback((e: React.PointerEvent) => {
    // Only drag on left click and not on interactive buttons/tabs
    if (e.button !== 0 || isMaximized) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[role="tab"]') || target.closest('[data-no-drag]')) {
      return;
    }

    const currentPos = position || {
      x: Math.max(20, window.innerWidth - size.width - 24),
      y: Math.max(20, window.innerHeight - size.height - 24),
    };

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: currentPos.x,
      startPosY: currentPos.y,
    };

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [isMaximized, position, size]);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const deltaX = e.clientX - dragRef.current.startX;
    const deltaY = e.clientY - dragRef.current.startY;

    const maxX = Math.max(0, window.innerWidth - size.width - 20);
    const maxY = Math.max(0, window.innerHeight - size.height - 20);

    const newX = Math.min(Math.max(10, dragRef.current.startPosX + deltaX), maxX);
    const newY = Math.min(Math.max(10, dragRef.current.startPosY + deltaY), maxY);

    setPosition({ x: newX, y: newY });
  }, [size, setPosition]);

  const handleDragEnd = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  }, []);

  // Handle Resizing (Bottom-Right corner)
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || isMaximized) return;
    e.stopPropagation();
    e.preventDefault();

    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: size.width,
      startH: size.height,
    };

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [isMaximized, size]);

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const deltaX = e.clientX - resizeRef.current.startX;
    const deltaY = e.clientY - resizeRef.current.startY;

    const newW = Math.max(380, Math.min(resizeRef.current.startW + deltaX, window.innerWidth - 40));
    const newH = Math.max(420, Math.min(resizeRef.current.startH + deltaY, window.innerHeight - 40));

    setSize({ width: newW, height: newH });
  }, [setSize]);

  const handleResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  }, []);

  // Compute default placement if position is null
  const stylePos = useMemo(() => {
    if (isMaximized) return undefined;
    if (position) {
      return {
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
      };
    }
    return {
      right: '24px',
      bottom: '24px',
      width: `${size.width}px`,
      height: `${size.height}px`,
    };
  }, [isMaximized, position, size]);

  if (!isOpen) {
    return null;
  }

  // Minimized Pill Mode
  if (isMinimized) {
    return (
      <div className="fixed bottom-5 right-6 z-50 animate-fade-in">
        <button
          onClick={restore}
          className="flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-card/95 backdrop-blur-md border border-border shadow-xl hover:border-primary/50 text-foreground transition-all duration-200 cursor-pointer group"
          title="Restore floating workspace chat"
        >
          <div className="size-7 rounded-full bg-primary/10 grid place-items-center text-primary group-hover:scale-105 transition-transform">
            <Bot className="size-4" />
          </div>
          <div className="flex flex-col items-start text-left">
            <span className="text-xs font-semibold leading-tight flex items-center gap-1.5">
              Workspace Chat
              {openTabs.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-primary/20 text-primary text-[10px] font-bold">
                  {openTabs.length}
                </span>
              )}
            </span>
            <span className="text-[10px] text-muted-foreground leading-tight max-w-[140px] truncate">
              {activeWorkspace?.branchName || 'No active tab'}
            </span>
          </div>
          <Maximize2 className="size-3.5 text-muted-foreground group-hover:text-foreground ml-1" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={modalRef}
      style={stylePos}
      className={cn(
        'fixed z-50 flex flex-col overflow-hidden bg-card/98 backdrop-blur-xl border border-border/80 shadow-2xl rounded-2xl transition-[border-color] duration-150',
        isMaximized && 'inset-4 w-auto h-auto rounded-xl',
      )}
    >
      {/* Header Bar & Drag Handle */}
      <div
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        className={cn(
          'flex items-center justify-between px-3 py-2 border-b border-border/80 bg-muted/40 select-none shrink-0',
          !isMaximized && 'cursor-grab active:cursor-grabbing',
        )}
      >
        <div className="flex items-center gap-2 min-w-0 pr-2">
          {!isMaximized && <GripHorizontal className="size-4 text-muted-foreground/50 shrink-0" />}
          <div className="size-5 rounded-md bg-primary/15 grid place-items-center text-primary shrink-0">
            <Bot className="size-3.5" />
          </div>
          <span className="text-xs font-bold text-foreground truncate shrink-0">
            Workspace Chat
          </span>
        </div>

        {/* Window Control Buttons */}
        <div className="flex items-center gap-1 shrink-0" data-no-drag>
          <button
            onClick={minimize}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
            title="Minimize"
            aria-label="Minimize floating chat"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            onClick={toggleMaximize}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
            title={isMaximized ? 'Restore down' : 'Maximize'}
            aria-label={isMaximized ? 'Restore down floating chat' : 'Maximize floating chat'}
          >
            {isMaximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
          <button
            onClick={close}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
            title="Close"
            aria-label="Close floating chat"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Tabs Row */}
      <div className="flex items-center gap-1 px-2.5 py-1.5 border-b border-border/60 bg-muted/20 overflow-x-auto no-scrollbar shrink-0" data-no-drag>
        {openTabs.map((branchName) => {
          const ws = workspaceMap.get(branchName);
          const isActive = branchName === activeTab;

          return (
            <div
              key={branchName}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(branchName)}
              className={cn(
                'group flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer border shrink-0 max-w-[170px]',
                isActive
                  ? 'bg-card border-border shadow-xs text-foreground font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
              title={branchName}
            >
              {getWorkspaceChatIcon(ws)}
              <span className="truncate">{branchName}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTab(branchName);
                }}
                className="size-3.5 rounded grid place-items-center text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5"
                title={`Close ${branchName} tab`}
                aria-label={`Close ${branchName} tab`}
              >
                <X className="size-2.5" />
              </button>
            </div>
          );
        })}

        {/* Plus / Add Workspace Dropdown Menu */}
        <Menu>
          <MenuTrigger className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-dashed border-border/70 hover:border-border transition-colors cursor-pointer shrink-0">
            <Plus className="size-3" />
            <span>Add Workspace</span>
          </MenuTrigger>
          <MenuPopup align="start" className="w-64 p-1.5">
            <div className="px-2 py-1 mb-1">
              <div className="relative">
                <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search workspaces..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-7 pr-2 py-1 text-xs rounded-md bg-muted/50 border border-border focus:outline-hidden focus:border-primary/50 text-foreground placeholder:text-muted-foreground"
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {filteredWorkspaces.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No workspaces found
                </div>
              ) : (
                filteredWorkspaces.map((ws) => {
                  const isOpen = openTabs.includes(ws.branchName);
                  return (
                    <MenuItem
                      key={ws.branchName}
                      onClick={() => {
                        if (isOpen) {
                          setActiveTab(ws.branchName);
                        } else {
                          addTab(ws.branchName);
                        }
                        setSearchQuery('');
                      }}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1.5 text-xs rounded-md cursor-pointer',
                        ws.branchName === activeTab && 'bg-accent/70 font-semibold',
                      )}
                    >
                      {getWorkspaceChatIcon(ws)}
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-medium text-foreground truncate">{ws.branchName}</span>
                        {ws.description && (
                          <span className="text-[10px] text-muted-foreground truncate">{ws.description}</span>
                        )}
                      </div>
                      {isOpen && (
                        <span className="text-[10px] text-primary font-medium px-1.5 py-0.5 rounded bg-primary/10">
                          Open
                        </span>
                      )}
                    </MenuItem>
                  );
                })
              )}
            </div>
          </MenuPopup>
        </Menu>
      </div>

      {/* Main Chat Body (Multi-Tab Mounted Execution) */}
      <div className="flex-1 min-h-0 relative overflow-hidden bg-card" data-no-drag>
        {openTabs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center text-muted-foreground gap-3">
            <div className="size-12 rounded-2xl bg-muted/50 border border-border grid place-items-center text-muted-foreground">
              <MessageSquare className="size-6 text-primary" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">No Workspace Tab Open</h3>
              <p className="text-xs text-muted-foreground max-w-xs">
                Select a workspace below to start or continue an AI assistant chat session.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 mt-2 max-w-sm">
              {workspaces.slice(0, 5).map((ws) => (
                <Button
                  key={ws.branchName}
                  variant="outline"
                  size="sm"
                  onClick={() => addTab(ws.branchName)}
                  className="text-xs h-7 gap-1.5"
                >
                  {getWorkspaceChatIcon(ws)}
                  <span>{ws.branchName}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : (
          openTabs.map((branchName) => {
            const ws = workspaceMap.get(branchName);
            if (!ws) return null;
            const isTabActive = branchName === activeTab;

            return (
              <div
                key={branchName}
                className={cn('h-full flex flex-col', !isTabActive && 'hidden')}
              >
                <AgentChat ws={ws} />
              </div>
            );
          })
        )}
      </div>

      {/* Resize Handle (Bottom-Right Corner) */}
      {!isMaximized && (
        <div
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          className="absolute bottom-0 right-0 size-4 cursor-nwse-resize z-10 grid place-items-center opacity-30 hover:opacity-100 transition-opacity"
          title="Drag to resize"
        >
          <div className="size-2 border-r-2 border-b-2 border-muted-foreground rounded-br-xs" />
        </div>
      )}
    </div>
  );
}
