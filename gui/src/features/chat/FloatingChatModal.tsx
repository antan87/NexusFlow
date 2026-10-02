import { TerminalWorkspace } from '../terminal/TerminalWorkspace.js';
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BellRing,
  MessagesSquare,
  X,
  Minus,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  GripHorizontal,
  FolderGit2,
  MessageSquare,
  Columns2,
} from 'lucide-react';
import { HarnessIcon, harnessName } from '../../components/icons/HarnessIcon.js';
import { Button } from '../../components/ui/button.js';
import { Menu, MenuItem, MenuPopup, MenuSearchInput, MenuTrigger } from '../../components/ui/menu.js';
import { cn } from '../../lib/utils.js';
import type { Feature } from '../../types.js';
import { useFloatingChat, CHAT_GEOMETRY, clampChatSize } from './floatingChatStore.js';
import { attentionStore } from './chatAttention.js';
import { useChatAttention, useWindowAttentive } from './useChatAttention.js';

interface FloatingChatModalProps {
  workspaces: Feature[];
}

export function FloatingChatModal({ workspaces }: FloatingChatModalProps) {
  const navigate = useNavigate();
  const {
    isOpen,
    isMinimized,
    isMaximized,
    openTabs,
    activeTab,
    splitTab,
    splitRatio,
    position,
    size,
    close,
    minimize,
    restore,
    toggleMaximize,
    addTab,
    openCli,
    removeTab,
    setActiveTab,
    setSplitTab,
    setSplitRatio,
    setPosition,
    setSize,
    terminalLaunches, consumeTerminalLaunch, harnesses,
  } = useFloatingChat();

  const [searchQuery, setSearchQuery] = useState('');
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerVisibleCount, setPickerVisibleCount] = useState(12);
  const [terminalStates, setTerminalStates] = useState<Record<string, 'idle' | 'running' | 'exited' | 'disconnected'>>({});
  const [unreadOutput, setUnreadOutput] = useState<Record<string, boolean>>({});
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef(false);
  const [wideEnough, setWideEnough] = useState(() => window.innerWidth >= CHAT_GEOMETRY.splitBreakpointPx);
  useEffect(() => {
    const update = () => setWideEnough(window.innerWidth >= CHAT_GEOMETRY.splitBreakpointPx);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const showSplit = Boolean(splitTab && activeTab && splitTab !== activeTab && wideEnough && isMaximized);
  const runningTabs = openTabs.filter(tab => terminalStates[tab] === 'running');
  const disconnectedTabs = openTabs.filter(tab => terminalStates[tab] === 'disconnected');
  useEffect(() => {
    if (!isOpen || isMinimized) return;
    const visible = [activeTab, showSplit ? splitTab : null].filter((value): value is string => Boolean(value));
    setUnreadOutput(current => {
      if (!visible.some(tab => current[tab])) return current;
      const next = { ...current };
      for (const tab of visible) next[tab] = false;
      return next;
    });
  }, [isOpen, isMinimized, activeTab, splitTab, showSplit]);

  // A request counts as seen once its chat is on screen in a window the user is
  // looking at. A chat left open on another monitor must keep its alert.
  const { pending, waiting } = useChatAttention();
  const attentive = useWindowAttentive();
  useEffect(() => {
    if (!isOpen || isMinimized || !attentive) return;
    const visible = new Set([activeTab, showSplit ? splitTab : null].filter((value): value is string => Boolean(value)));
    for (const request of pending) {
      if (visible.has(request.workspaceId)) attentionStore.markSeen(request.workspaceId, request.id);
    }
  }, [pending, isOpen, isMinimized, attentive, activeTab, splitTab, showSplit]);

  const moveSplit = useCallback((event: React.PointerEvent) => {
    if (!splitDragRef.current || !bodyRef.current) return;
    const bounds = bodyRef.current.getBoundingClientRect();
    setSplitRatio(((event.clientX - bounds.left) / bounds.width) * 100);
  }, [setSplitRatio]);

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

  // The empty state's own search, kept separate from the header menu's query so
  // the two surfaces never clear or filter each other.
  const pickerQueryTrimmed = pickerQuery.trim();
  const pickerMatches = useMemo(() => {
    const q = pickerQueryTrimmed.toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter(
      (w) => w.branchName.toLowerCase().includes(q) || (w.description && w.description.toLowerCase().includes(q)),
    );
  }, [workspaces, pickerQueryTrimmed]);

  // Progressive reveal rather than a hard cap: a long list stays scannable, but
  // nothing becomes unreachable the way a fixed slice made it.
  const pickerVisible = pickerMatches.slice(0, pickerVisibleCount);

  // Announced through a status region that exists before the first keystroke;
  // the visible "No workspaces match" line alone is never read out.
  const pickerAnnouncement = !pickerQueryTrimmed ? ''
    : pickerMatches.length === 0 ? `No workspaces match "${pickerQueryTrimmed}"`
    : `${pickerMatches.length} ${pickerMatches.length === 1 ? 'workspace matches' : 'workspaces match'}`;

  // The picker unmounts what was just activated: choosing a workspace removes the
  // whole empty state, and the last "Show N more" click removes its own button.
  // Move focus to what replaced it so keyboard and screen-reader users are not
  // dropped back on <body>.
  const pickerListRef = useRef<HTMLDivElement>(null);
  const focusOpenedTab = useRef<string | null>(null);
  const focusRevealedIndex = useRef<number | null>(null);
  useEffect(() => {
    const branch = focusOpenedTab.current;
    if (!branch || !openTabs.includes(branch)) return;
    focusOpenedTab.current = null;
    modalRef.current?.querySelector<HTMLElement>(`[role="tab"][title="${CSS.escape(branch)}"]`)?.focus();
  }, [openTabs]);
  useEffect(() => {
    const index = focusRevealedIndex.current;
    if (index === null) return;
    focusRevealedIndex.current = null;
    pickerListRef.current?.querySelectorAll<HTMLElement>('button')[index]?.focus();
  }, [pickerVisibleCount]);

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
    } catch {
      // Non-fatal if pointer capture was already released
    }
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
    setSize(clampChatSize({
      width: resizeRef.current.startW + deltaX,
      height: resizeRef.current.startH + deltaY,
    }));
  }, [setSize]);

  const handleResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Non-fatal if pointer capture was already released
    }
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

  return <>
    {isOpen && isMinimized && (
      <div className="fixed bottom-5 right-6 z-50 animate-fade-in">
        <button
          onClick={restore}
          className={cn(
            'flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-card/95 backdrop-blur-md border border-border shadow-xl hover:border-primary/50 text-foreground transition-all duration-200 cursor-pointer group',
            waiting.size > 0 && 'border-amber-500/70 hover:border-amber-500',
          )}
          title="Restore floating CLI chat"
        >
          <div className="size-7 rounded-full bg-primary/10 grid place-items-center text-primary group-hover:scale-105 transition-transform">
            <MessagesSquare className="size-4" />
          </div>
          <div className="flex flex-col items-start text-left">
            <span className="text-xs font-semibold leading-tight flex items-center gap-1.5">
              CLI Chat
              {openTabs.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-primary/20 text-primary text-[10px] font-bold">
                  {openTabs.length}
                </span>
              )}
            </span>
            <span className="text-[10px] text-muted-foreground leading-tight max-w-[140px] truncate">
              {waiting.size > 0 ? `${waiting.size} waiting for you` : runningTabs.length ? `CLI running · hidden${runningTabs.length > 1 ? ` (${runningTabs.length})` : ''}` : disconnectedTabs.length ? 'CLI disconnected · hidden' : activeWorkspace?.branchName || 'No active tab'}
            </span>
          </div>
          <Maximize2 className="size-3.5 text-muted-foreground group-hover:text-foreground ml-1" />
        </button>
      </div>
    )}

    <div
      ref={modalRef}
      style={{ ...stylePos, display: !isOpen || isMinimized ? 'none' : undefined }}
      role="region" aria-label="CLI Chat"
      className={cn(
        'fixed z-50 flex flex-col overflow-hidden bg-card/98 backdrop-blur-xl border border-border/80 shadow-2xl rounded-2xl transition-[border-color] duration-150',
        isMaximized && 'inset-0 w-auto h-auto rounded-none',
      )}
    >
      {/* Window chrome. The workspace tabs used to sit on a second row and the
          per-pane sub-header on a third, so three bars and three "CLI chat"
          labels appeared before any terminal output. Tabs are now inline with
          the title and the sub-header is gone. */}
      <div
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        className={cn(
          'flex items-center gap-2 px-2.5 py-1.5 border-b border-border/80 bg-muted/40 select-none shrink-0',
          !isMaximized && 'cursor-grab active:cursor-grabbing',
        )}
      >
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          {!isMaximized && <GripHorizontal className="size-4 text-muted-foreground shrink-0" />}
          <div className="size-5 rounded-md bg-primary/15 grid place-items-center text-primary shrink-0" aria-hidden="true">
            <MessagesSquare className="size-3.5" />
          </div>
          <span className="text-xs font-bold text-foreground shrink-0">CLI chat</span>
        </div>

        {/* The tab strip scrolls, so a waiting chat can be out of sight; this stays put and jumps to the one waiting longest. */}
        {pending.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab(pending[0]!.workspaceId)}
            title={pending.map((request) => `${request.workspaceId}: ${request.message}`).join('\n')}
            aria-label={`${pending.length} ${pending.length === 1 ? 'chat' : 'chats'} waiting for you. Show ${pending[0]!.workspaceId}.`}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-amber-500/70 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-amber-500/20"
          >
            <BellRing className="size-3 text-amber-500" aria-hidden="true" />
            {pending.length} waiting
          </button>
        )}

        <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto no-scrollbar" data-no-drag>
          {openTabs.map((branchName) => {
            const isActive = branchName === activeTab;
            return (
              <div
                key={branchName}
                className={cn(
                  'group flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer border shrink-0 max-w-[170px]',
                  isActive || splitTab === branchName
                    ? 'bg-card border-border shadow-xs text-foreground font-semibold'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
                  waiting.has(branchName) && 'border-amber-500/70 bg-amber-500/10 text-foreground',
                )}
              >
                <button type="button" role="tab" aria-selected={isActive || splitTab === branchName} aria-label={`Show ${branchName} in the left pane${waiting.has(branchName) ? ', waiting for your input' : ''}`} title={branchName}
                  className="flex min-w-0 items-center gap-1.5" onClick={() => setActiveTab(branchName)}>
                  <FolderGit2 className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{branchName}</span>
                  {harnesses[branchName] && <span title={harnessName(harnesses[branchName])}><HarnessIcon harness={harnesses[branchName]} className="size-3" /></span>}
                  {terminalStates[branchName] && terminalStates[branchName] !== 'idle' && <span title={`Terminal ${terminalStates[branchName]}`} className={cn('size-1.5 shrink-0 rounded-full', terminalStates[branchName] === 'running' ? 'bg-emerald-500' : terminalStates[branchName] === 'disconnected' ? 'bg-amber-500' : 'bg-muted-foreground')} />}
                  {unreadOutput[branchName] && <span title="New terminal output" className="size-1.5 shrink-0 rounded-full bg-primary" />}
                  {waiting.has(branchName) && <span title="Waiting for your input" className="size-2 shrink-0 animate-pulse rounded-full bg-amber-500" />}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTab(branchName);
                  }}
                  className="size-3.5 rounded grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-70 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
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
            <MenuTrigger aria-label="Add workspace" className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-dashed border-border/70 hover:border-border transition-colors cursor-pointer shrink-0" title="Add workspace">
              <Plus className="size-3" />
              <span className="hidden sm:inline">Workspace</span>
            </MenuTrigger>
            <MenuPopup align="start" className="w-64 p-1.5">
              <MenuItem onClick={() => { minimize(); navigate('/new?from=chat'); }} className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold">
                <Plus className="size-3" />New workspace
              </MenuItem>
              <p className="border-t border-border px-2 pt-2 text-[10px] text-muted-foreground">Open existing</p>
              <div className="px-2 py-1 mb-1">
                <div className="relative">
                  <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" aria-hidden="true" />
                  <MenuSearchInput
                    aria-label="Search workspaces to add"
                    placeholder="Search workspaces..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-7"
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
                        <FolderGit2 className="size-3 shrink-0" aria-hidden="true" />
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

        {/* Window Control Buttons */}
        <div className="flex items-center gap-1 shrink-0" data-no-drag>
          {activeTab && <Menu>
            <MenuTrigger aria-label="Dock a second workspace" className="inline-flex items-center gap-1 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer" title="Dock a second workspace beside this one">
              <Columns2 className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" className="w-56 max-h-72 overflow-y-auto p-1.5">
              {splitTab && <MenuItem onClick={() => setSplitTab(null)} className="text-xs">Close docked workspace</MenuItem>}
              {workspaces.filter(workspace => workspace.branchName !== activeTab).map(workspace => <MenuItem key={workspace.branchName}
                onClick={() => setSplitTab(workspace.branchName)} className="flex items-center gap-2 text-xs">
                <FolderGit2 className="size-3" /><span className="truncate">{workspace.branchName}</span>{splitTab === workspace.branchName && <span className="ml-auto text-primary">Docked</span>}
              </MenuItem>)}
              {workspaces.length < 2 && <p className="p-2 text-xs text-muted-foreground">Open another workspace to dock it here.</p>}
            </MenuPopup>
          </Menu>}
          <button
            onClick={minimize}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
            title="Minimize window; CLI sessions keep running"
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
            title="Hide window; CLI sessions keep running"
            aria-label="Close floating chat"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {splitTab && (!wideEnough || !isMaximized) && <p className="border-b border-border px-3 py-1 text-xs text-muted-foreground">Docking is paused. Maximize the window on a wide screen to resume it.</p>}
      {/* Main Chat Body (Multi-Tab Mounted Execution) */}
      <div ref={bodyRef} className="flex flex-1 min-h-0 relative overflow-hidden bg-card" data-no-drag>
        {openTabs.length === 0 ? (
          <div className="h-full w-full flex flex-col items-center p-6 text-center text-muted-foreground gap-3 overflow-y-auto">
            <div className="size-12 rounded-2xl bg-muted/50 border border-border grid place-items-center text-muted-foreground shrink-0">
              <MessageSquare className="size-6 text-primary" />
            </div>
            <div className="space-y-1 shrink-0">
              <h3 className="text-sm font-semibold text-foreground">Choose a workspace for CLI chat</h3>
              <p className="text-xs text-muted-foreground max-w-xs">
                Open an existing workspace or create one. A session starts only when you choose to start or resume it.
              </p>
            </div>
            {/* This state used to render workspaces.slice(0, 5) with no way to
                reach the rest. Search plus progressive reveal keeps every
                workspace reachable without dumping a long list at once. */}
            {workspaces.length > 0 && (
              <div className="relative w-full max-w-sm shrink-0">
                <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search workspaces for CLI chat"
                  placeholder="Search workspaces..."
                  value={pickerQuery}
                  onChange={(event) => { setPickerQuery(event.target.value); setPickerVisibleCount(12); }}
                  className="h-8 w-full rounded-md border border-input bg-card pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                />
                <p role="status" data-testid="cli-chat-picker-results" className="sr-only">{pickerAnnouncement}</p>
              </div>
            )}
            <div className="flex w-full max-w-sm flex-col gap-1.5">
              {workspaces.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">No workspaces yet.</p>
              ) : pickerMatches.length === 0 ? (
                // The status region above already says this; hidden so it is not read twice.
                <p aria-hidden="true" className="py-2 text-xs text-muted-foreground">No workspaces match "{pickerQueryTrimmed}"</p>
              ) : (
                <>
                  <div ref={pickerListRef} className="flex flex-col gap-1.5" role="group" aria-label="Workspaces available for CLI chat">
                    {pickerVisible.map((ws) => (
                      <Button
                        key={ws.branchName}
                        variant="outline"
                        size="sm"
                        onClick={() => { focusOpenedTab.current = ws.branchName; openCli(ws.branchName); setPickerQuery(''); }}
                        className="text-xs h-7 justify-start gap-1.5"
                      >
                        <FolderGit2 className="size-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{ws.branchName}</span>
                        {ws.description && <span className="truncate text-[10px] text-muted-foreground font-normal">{ws.description}</span>}
                      </Button>
                    ))}
                  </div>
                  {pickerMatches.length > pickerVisible.length && (
                    <Button variant="ghost" size="sm" onClick={() => { focusRevealedIndex.current = pickerVisible.length; setPickerVisibleCount(count => count + 24); }}
                      className="text-xs h-7">
                      Show {Math.min(24, pickerMatches.length - pickerVisible.length)} more of {pickerMatches.length}
                    </Button>
                  )}
                </>
              )}
              <Button variant="outline" size="sm" onClick={() => { minimize(); navigate('/new?from=chat'); }} className="text-xs h-7 gap-1.5"><Plus className="size-3" />Create workspace for CLI chat</Button>
            </div>
          </div>
        ) : (
          openTabs.map((branchName) => {
            const ws = workspaceMap.get(branchName);
            const isPrimary = branchName === activeTab;
            const isSecondary = showSplit && branchName === splitTab;
            const visible = isPrimary || isSecondary;

            return (
              <div
                key={branchName}
                className={cn('h-full min-w-0 flex-col', visible ? 'flex' : 'hidden', isSecondary && 'border-l border-border')}
                style={visible ? { order: isPrimary ? 1 : 3, flex: showSplit ? isPrimary ? `0 0 ${splitRatio}%` : '1 1 0%' : '1 1 100%' } : undefined}
              >
                {isSecondary && <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border px-2 py-1" data-no-drag>
                  <span className="min-w-0 truncate text-[10px] text-muted-foreground" title={branchName}>{branchName}</span>
                  <Button size="xs" variant="ghost" aria-label="Undock this workspace" onClick={() => setSplitTab(null)}><X className="size-3" /></Button>
                </div>}
                {!ws ? <div role="status" className="space-y-2 p-4 text-xs text-muted-foreground"><p>This workspace is unavailable. It may have been removed or is still loading.</p><Button size="xs" variant="outline" onClick={() => removeTab(branchName)}>Close unavailable tab</Button></div> : <>
                  <div className="flex-1 min-h-0">
                    <TerminalWorkspace workspace={branchName} workspacePath={ws.workspacePath} repoPaths={ws.repos} active={isOpen && !isMinimized && visible} launch={terminalLaunches[branchName]} consumeLaunch={id => consumeTerminalLaunch(branchName, id)}
                      onStatusChange={status => setTerminalStates(current => current[branchName] === status ? current : { ...current, [branchName]: status })}
                      onBackgroundOutput={() => setUnreadOutput(current => current[branchName] ? current : { ...current, [branchName]: true })} />
                  </div>
                </>}
              </div>
            );
          })
        )}
        {showSplit && <div role="separator" aria-label="Resize workspace panes" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(splitRatio)} tabIndex={0}
          className="order-2 z-10 w-1.5 shrink-0 cursor-col-resize bg-border/70 hover:bg-primary/40 focus-visible:bg-primary/40"
          onPointerDown={event => { splitDragRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={moveSplit}
          onPointerUp={event => { splitDragRef.current = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { splitDragRef.current = false; }}
          onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSplitRatio(splitRatio + (event.key === 'ArrowRight' ? 5 : -5)); } }} />}
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
  </>;
}
