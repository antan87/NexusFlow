import { TerminalWorkspace } from '../terminal/TerminalWorkspace.js';
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  X,
  Plus,
  Search,
  FolderGit2,
  MessageSquare,
  Columns2,
} from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { ContextRing } from '../../components/ui/context-ring.js';
import { Menu, MenuItem, MenuPopup, MenuSearchInput, MenuTrigger } from '../../components/ui/menu.js';
import { cn } from '../../lib/utils.js';
import type { Feature } from '../../types.js';
import { currentMilestoneIndex, ringMilestones } from '../progress/progressView.js';
import { useFloatingChat, floatingChatStore, CHAT_GEOMETRY } from './floatingChatStore.js';
import { attentionStore } from './chatAttention.js';
import { useChatAttention, useWindowAttentive } from './useChatAttention.js';
import { useChatDockSlot, useDockRect } from './dockPlacement.js';
import { browserPath, goToWorkspace, parseWorkspacePath, showsChatFor } from './chatRoute.js';
import { threadNote } from './chatThreads.js';
import { useChatThreads } from './useChatThreads.js';
import { RUNNING_TERMINALS_KEY, useLiveSessions } from './useLiveSessions.js';
import { liveText } from './liveSessions.js';
import { LiveDot } from './LiveMarker.js';
import { ChatList } from './ChatList.js';

interface ChatDockProps {
  workspaces: Feature[];
}

/**
 * The CLI chat, docked as the centre of the workspace screen. It lives above the
 * router, so every open workspace's terminal keeps running, keeps its scrollback
 * and keeps its unsent text while the user reads a plan or reviews changes. It is
 * only shown over the slot the Chat destination provides; everywhere else it is
 * hidden, not unmounted. The tabs along its top are the open workspaces, one
 * click apart.
 */
export function ChatDock({ workspaces }: ChatDockProps) {
  const navigate = useNavigate();
  const {
    openTabs,
    activeTab,
    splitTab,
    splitRatio,
    focusRequest,
    addTab,
    openCli,
    removeTab,
    setSplitTab,
    setSplitRatio,
    terminalLaunches, consumeTerminalLaunch,
  } = useFloatingChat();

  const slot = useChatDockSlot();
  const rect = useDockRect(slot);
  const onScreen = rect !== null;
  // The effects below run on events, and need to know whether the chat is on screen as of that moment.
  const onScreenRef = useRef(onScreen);
  useEffect(() => { onScreenRef.current = onScreen; }, [onScreen]);

  const [searchQuery, setSearchQuery] = useState('');
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerVisibleCount, setPickerVisibleCount] = useState(12);
  const [terminalStates, setTerminalStates] = useState<Record<string, 'idle' | 'running' | 'exited' | 'disconnected'>>({});
  const [unreadOutput, setUnreadOutput] = useState<Record<string, boolean>>({});
  const dockRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef(false);
  // A second workspace beside the first needs room for two terminals.
  const wideEnough = (rect?.width ?? 0) >= CHAT_GEOMETRY.splitBreakpointPx;
  const showSplit = Boolean(splitTab && activeTab && splitTab !== activeTab && wideEnough);

  // Anything in the app can ask to see a chat (a waiting alert, "resume in chat", a session link).
  // The dock answers by going to that workspace's chat. The first value is the one at load, so a reload stays put.
  const seenFocus = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === seenFocus.current) return;
    seenFocus.current = focusRequest;
    if (!activeTab) return;
    // Compared with the browser's address, which is already where the user is going, not the page's older copy.
    // The part open beside the chat stays open for the workspace that takes its place, so choosing another workspace
    // while reading the plan shows its plan beside its chat.
    const here = browserPath();
    if (showsChatFor(here, activeTab, onScreenRef.current)) return;
    goToWorkspace(navigate, activeTab, onScreenRef.current ? parseWorkspacePath(here)?.section ?? 'chat' : 'chat');
  }, [focusRequest, activeTab, navigate]);

  useEffect(() => {
    if (!onScreen) return;
    const shown = [activeTab, showSplit ? splitTab : null].filter((value): value is string => Boolean(value));
    setUnreadOutput(current => {
      if (!shown.some(tab => current[tab])) return current;
      const next = { ...current };
      for (const tab of shown) next[tab] = false;
      return next;
    });
  }, [onScreen, activeTab, splitTab, showSplit]);

  // A request counts as seen once its chat is on screen in a window the user is
  // looking at. A chat left open on another monitor must keep its alert.
  const { pending, waiting } = useChatAttention();
  const attentive = useWindowAttentive();
  // What each open chat is working on and how far it is, for its tab and for the list of chats.
  const chatData = useChatThreads(workspaces, onScreen);
  // Which chats have a CLI running, read from the server, the same as the sidebar shows.
  const { live, now: liveNow } = useLiveSessions();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!onScreen || !attentive) return;
    const shown = new Set([activeTab, showSplit ? splitTab : null].filter((value): value is string => Boolean(value)));
    for (const request of pending) {
      if (shown.has(request.workspaceId)) attentionStore.markSeen(request.workspaceId, request.id);
    }
  }, [pending, onScreen, attentive, activeTab, splitTab, showSplit]);

  const moveSplit = useCallback((event: React.PointerEvent) => {
    if (!splitDragRef.current || !bodyRef.current) return;
    const bounds = bodyRef.current.getBoundingClientRect();
    setSplitRatio(((event.clientX - bounds.left) / bounds.width) * 100);
  }, [setSplitRatio]);

  // Map open branch names to workspace objects
  const workspaceMap = useMemo(() => {
    return new Map(workspaces.map((w) => [w.branchName, w]));
  }, [workspaces]);

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
  // Closing the tab that has focus would drop it on <body>; the tab that takes its place receives it.
  const closeTab = (branchName: string) => {
    removeTab(branchName);
    const next = floatingChatStore.getState().activeTab;
    if (next) focusOpenedTab.current = next;
  };
  const focusRevealedIndex = useRef<number | null>(null);
  useEffect(() => {
    const branch = focusOpenedTab.current;
    if (!branch || !openTabs.includes(branch)) return;
    focusOpenedTab.current = null;
    dockRef.current?.querySelector<HTMLElement>(`[role="tab"][data-branch="${CSS.escape(branch)}"]`)?.focus();
  }, [openTabs]);
  useEffect(() => {
    const index = focusRevealedIndex.current;
    if (index === null) return;
    focusRevealedIndex.current = null;
    pickerListRef.current?.querySelectorAll<HTMLElement>('button')[index]?.focus();
  }, [pickerVisibleCount]);

  return (
    <div
      ref={dockRef}
      style={rect ? { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` } : { display: 'none' }}
      role="region" aria-label="CLI Chat"
      className="fixed z-10 flex flex-col overflow-hidden bg-card"
    >
      {/* The tabs are the open workspaces. Choosing one goes to that workspace's chat address, so the address
          always says which chat this is, and back and forward move between them. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/80 bg-muted/40 px-2.5 py-1.5">
        {openTabs.length > 0 && (
          <ChatList
            activeBranch={activeTab}
            rows={openTabs.map((branch) => ({ branch, name: workspaceMap.get(branch)?.name || branch, summary: chatData.summaries.get(branch)!, facts: chatData.facts.get(branch), live: live.get(branch) }))}
            now={liveNow}
            onOpen={(branch) => goToWorkspace(navigate, branch, parseWorkspacePath(browserPath())?.section ?? 'chat')}
            onFinish={(branch) => goToWorkspace(navigate, branch, 'changes')}
            onClose={removeTab}
          />
        )}
        {/* The tab strip scrolls, so a waiting chat can be out of sight; this stays put and jumps to the one waiting longest. */}
        {pending.length > 0 && (
          <button
            type="button"
            onClick={() => goToWorkspace(navigate, pending[0]!.workspaceId, 'chat')}
            title={pending.map((request) => `${request.workspaceId}: ${request.message}`).join('\n')}
            aria-label={`${pending.length} ${pending.length === 1 ? 'chat' : 'chats'} waiting for you. Show ${pending[0]!.workspaceId}.`}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-amber-500/70 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-amber-500/20"
          >
            <BellRing className="size-3 text-amber-500" aria-hidden="true" />
            {pending.length} waiting
          </button>
        )}

        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div role="tablist" aria-label="Open chats" className="flex min-w-0 items-center gap-1 overflow-x-auto no-scrollbar">
            {openTabs.map((branchName) => {
              const isActive = branchName === activeTab;
              // A workspace is known by its name. The branch is a detail, shown when hovering.
              const label = workspaceMap.get(branchName)?.name || branchName;
              const summary = chatData.summaries.get(branchName)!;
              const noteId = `chat-note-${branchName}`;
              return (
                <div
                  key={branchName}
                  className={cn(
                    // Tabs share the strip, down to a name and a few letters of the goal, before it scrolls; the list of chats has the rest.
                    'group flex min-w-[7.5rem] max-w-[13rem] flex-[0_1_13rem] cursor-pointer items-center gap-1.5 rounded-lg border py-1 pl-2 pr-1.5 text-xs font-medium transition-[background-color,border-color,color] duration-150',
                    isActive || splitTab === branchName
                      ? 'border-border bg-card font-semibold text-foreground shadow-xs'
                      : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                    waiting.has(branchName) && 'border-amber-500/70 bg-amber-500/10 text-foreground',
                  )}
                >
                  {/* A tab holds nothing focusable, so the tab strip is a valid tab list. The Delete key closes the focused tab;
                      the cross is the same action for the mouse, and is not announced separately. */}
                  <button type="button" role="tab" aria-selected={isActive || splitTab === branchName} aria-keyshortcuts="Delete" aria-label={`Show ${label} in the left pane${waiting.has(branchName) ? ', waiting for your input' : ''}`} aria-describedby={noteId} title={label === branchName ? branchName : `${label} (${branchName})`} data-branch={branchName}
                    className="flex min-w-0 items-center gap-2" onClick={() => goToWorkspace(navigate, branchName, parseWorkspacePath(browserPath())?.section ?? 'chat')}
                    onKeyDown={(event) => {
                      if (event.key !== 'Delete') return;
                      event.preventDefault();
                      closeTab(branchName);
                    }}>
                    {/* The ring is the chat's progress at a glance; the line under the name says what it is working on. */}
                    <ContextRing aria-hidden="true" size={18} milestones={ringMilestones(chatData.facts.get(branchName))} currentIndex={currentMilestoneIndex(chatData.facts.get(branchName))} />
                    <span className="flex min-w-0 flex-col text-left">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{label}</span>
                        {/* A running terminal is the normal case, so only one that stopped or lost its connection is marked. */}
                        {(terminalStates[branchName] === 'exited' || terminalStates[branchName] === 'disconnected') && <span title={`Terminal ${terminalStates[branchName]}`} className={cn('size-1.5 shrink-0 rounded-full', terminalStates[branchName] === 'disconnected' ? 'bg-amber-500' : 'bg-muted-foreground')} />}
                        {unreadOutput[branchName] && <span title="New terminal output" className="size-1.5 shrink-0 rounded-full bg-primary" />}
                        {live.get(branchName)
                          ? <LiveDot state={live.get(branchName)!.state} title={liveText(live.get(branchName)!, liveNow)} />
                          : waiting.has(branchName) && <span title="Waiting for your input" className="size-2 shrink-0 animate-pulse rounded-full bg-amber-500" />}
                      </span>
                      {/* Every tab has the second line, so they line up: what the AI asks while it waits, else the goal, else the state,
                          else an empty line while loading. */}
                      <span aria-hidden="true" className="truncate text-[10.5px] font-normal leading-tight text-muted-foreground">{summary.question || summary.goal || summary.label || '\u00a0'}</span>
                    </span>
                    <span id={noteId} className="sr-only">{threadNote(summary)}</span>
                    <span
                      aria-hidden="true" data-close-tab={branchName} title={`Close ${branchName} tab`}
                      onClick={(event) => { event.stopPropagation(); closeTab(branchName); }}
                      // Only on the tab in front, or the one pointed at or focused, so a narrow tab keeps its room for the name.
                      className={cn('size-3.5 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-focus-within:grid group-hover:grid', isActive || splitTab === branchName ? 'grid' : 'hidden')}
                    >
                      <X className="size-2.5" />
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Plus / Add Workspace Dropdown Menu */}
          <Menu>
            <MenuTrigger aria-label="Add workspace" className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground" title="Add workspace">
              <Plus className="size-3.5" aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup align="start" className="w-64 p-1.5">
              <MenuItem onClick={() => navigate('/new?from=chat')} className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold">
                <Plus className="size-3" />New workspace
              </MenuItem>
              <p className="border-t border-border px-2 pt-2 text-[10px] text-muted-foreground">Open existing</p>
              <div className="mb-1 px-2 py-1">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
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
              <div className="max-h-56 space-y-0.5 overflow-y-auto">
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
                          addTab(ws.branchName);
                          setSearchQuery('');
                        }}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                          ws.branchName === activeTab && 'bg-accent/70 font-semibold',
                        )}
                      >
                        <FolderGit2 className="size-3 shrink-0" aria-hidden="true" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium text-foreground">{ws.name || ws.branchName}</span>
                          {ws.description && (
                            <span className="truncate text-[10px] text-muted-foreground">{ws.description}</span>
                          )}
                        </div>
                        {isOpen && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
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

        <div className="flex shrink-0 items-center gap-1">
          {activeTab && <Menu>
            <MenuTrigger aria-label="Dock a second workspace" className="inline-flex cursor-pointer items-center gap-1 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground" title="Show a second workspace beside this one">
              <Columns2 className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" className="max-h-72 w-56 overflow-y-auto p-1.5">
              {splitTab && <MenuItem onClick={() => setSplitTab(null)} className="text-xs">Close docked workspace</MenuItem>}
              {workspaces.filter(workspace => workspace.branchName !== activeTab).map(workspace => <MenuItem key={workspace.branchName}
                onClick={() => setSplitTab(workspace.branchName)} className="flex items-center gap-2 text-xs">
                <FolderGit2 className="size-3" /><span className="truncate">{workspace.branchName}</span>{splitTab === workspace.branchName && <span className="ml-auto text-primary">Docked</span>}
              </MenuItem>)}
              {workspaces.length < 2 && <p className="p-2 text-xs text-muted-foreground">Open another workspace to dock it here.</p>}
            </MenuPopup>
          </Menu>}
        </div>
      </div>

      {splitTab && !wideEnough && onScreen && <p className="border-b border-border px-3 py-1 text-xs text-muted-foreground">Showing two workspaces is paused. Make this area wider to resume it.</p>}
      {/* Main Chat Body (Multi-Tab Mounted Execution) */}
      <div ref={bodyRef} className="relative flex min-h-0 flex-1 overflow-hidden bg-card">
        {openTabs.length === 0 ? (
          <div className="flex h-full w-full flex-col items-center gap-3 overflow-y-auto p-6 text-center text-muted-foreground">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl border border-border bg-muted/50 text-muted-foreground">
              <MessageSquare className="size-6 text-primary" />
            </div>
            <div className="shrink-0 space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Choose a workspace for CLI chat</h3>
              <p className="max-w-xs text-xs text-muted-foreground">
                Open an existing workspace or create one. A session starts only when you choose to start or resume it.
              </p>
            </div>
            {/* This state used to render workspaces.slice(0, 5) with no way to
                reach the rest. Search plus progressive reveal keeps every
                workspace reachable without dumping a long list at once. */}
            {workspaces.length > 0 && (
              <div className="relative w-full max-w-sm shrink-0">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
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
                        className="h-7 justify-start gap-1.5 text-xs"
                      >
                        <FolderGit2 className="size-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{ws.branchName}</span>
                        {ws.description && <span className="truncate text-[10px] font-normal text-muted-foreground">{ws.description}</span>}
                      </Button>
                    ))}
                  </div>
                  {pickerMatches.length > pickerVisible.length && (
                    <Button variant="ghost" size="sm" onClick={() => { focusRevealedIndex.current = pickerVisible.length; setPickerVisibleCount(count => count + 24); }}
                      className="h-7 text-xs">
                      Show {Math.min(24, pickerMatches.length - pickerVisible.length)} more of {pickerMatches.length}
                    </Button>
                  )}
                </>
              )}
              <Button variant="outline" size="sm" onClick={() => navigate('/new?from=chat')} className="h-7 gap-1.5 text-xs"><Plus className="size-3" />Create workspace for CLI chat</Button>
            </div>
          </div>
        ) : (
          // The terminals stay in one fixed order, whatever order the tabs are in, so bringing a tab to the front never
          // moves a running terminal in the page.
          [...openTabs].sort().map((branchName) => {
            const ws = workspaceMap.get(branchName);
            const isPrimary = branchName === activeTab;
            const isSecondary = showSplit && branchName === splitTab;
            const shown = isPrimary || isSecondary;

            return (
              <div
                key={branchName}
                className={cn('h-full min-w-0 flex-col', shown ? 'flex' : 'hidden', isSecondary && 'border-l border-border')}
                style={shown ? { order: isPrimary ? 1 : 3, flex: showSplit ? isPrimary ? `0 0 ${splitRatio}%` : '1 1 0%' : '1 1 100%' } : undefined}
              >
                {isSecondary && <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border px-2 py-1">
                  <span className="min-w-0 truncate text-[10px] text-muted-foreground" title={branchName}>{branchName}</span>
                  <Button size="xs" variant="ghost" aria-label="Undock this workspace" onClick={() => setSplitTab(null)}><X className="size-3" /></Button>
                </div>}
                {!ws ? <div role="status" className="space-y-2 p-4 text-xs text-muted-foreground"><p>This workspace is unavailable. It may have been removed or is still loading.</p><Button size="xs" variant="outline" onClick={() => removeTab(branchName)}>Close unavailable tab</Button></div> : <>
                  <div className="min-h-0 flex-1">
                    <TerminalWorkspace workspace={branchName} workspacePath={ws.workspacePath} repoPaths={ws.repos} active={onScreen && shown} launch={terminalLaunches[branchName]} consumeLaunch={id => consumeTerminalLaunch(branchName, id)}
                      onStatusChange={status => {
                        setTerminalStates(current => current[branchName] === status ? current : { ...current, [branchName]: status });
                        // A CLI that starts or stops shows in the sidebar at once, not at the next read.
                        void queryClient.invalidateQueries({ queryKey: RUNNING_TERMINALS_KEY });
                      }}
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
    </div>
  );
}
