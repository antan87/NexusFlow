import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Kbd } from '../../components/ui/kbd.js';

/* ============================ types ============================ */
export type VimMode = 'normal' | 'insert' | 'command';
export interface VimCommands {
  [name: string]: () => void;
}

export interface VimCtx {
  enabled: boolean;
  toggle: () => void;
  mode: VimMode;
  setMode: (m: VimMode) => void;
  status: string; // pending keys, e.g. "g" or "12"
  scope: string; // active data-vim-scope
  message: string; // transient statusline msg (errors etc.)
  say: (msg: string) => void;
  helpOpen: boolean;
  setHelpOpen: (v: boolean) => void;
}

export interface VimKeymapEntry {
  key: string;
  description: string;
}

export interface VimKeymapSection {
  category: string;
  entries: VimKeymapEntry[];
}

export const VIM_KEYMAP_SECTIONS: VimKeymapSection[] = [
  {
    category: '🧭 Navigation & Scrolling',
    entries: [
      { key: 'j / k', description: 'Next / previous item in active view (clamped at top/bottom, prefix count: 3j)' },
      { key: 'gg / G', description: 'Jump directly to first (top) / last (bottom) item' },
      { key: 'Ctrl+d / Ctrl+u', description: 'Smooth scroll half-page down / up' },
      { key: 'Enter / Space', description: 'Activate or click the focused item' },
    ],
  },
  {
    category: '📑 View & Tab Switching',
    entries: [
      { key: 'h / l', description: 'Switch to previous / next view tab or workspace subtab' },
      { key: 'gt / gT', description: 'Cycle forward / backward through tabs' },
      { key: 'g1 – g9', description: 'Jump directly to tab index 1–9' },
    ],
  },
  {
    category: '⚡ Quick Workspace Actions',
    entries: [
      { key: 's / S', description: 'Start / Stop workspace services' },
      { key: 'L', description: 'Open workspace logs console' },
      { key: 'o', description: 'Open workspace in editor / inspect' },
      { key: 'd / c', description: 'View changes diff / Commit changes' },
      { key: 'r / f', description: 'Sync repository changes / Refresh data' },
    ],
  },
  {
    category: '💬 Command Line Mode (:)',
    entries: [
      { key: ':help / :h', description: 'Open this commands cheatsheet dialog' },
      { key: ':top / :bottom', description: 'Jump to top (first) / bottom (last) item' },
      { key: ':start / :stop / :logs', description: 'Run workspace service controls' },
      { key: ':diff / :commit / :sync', description: 'Run git operations (:w also commits)' },
      { key: ':tab <name>', description: 'Switch to tab (e.g. :tab settings, :tab workspaces)' },
      { key: ':refresh / :doctor', description: 'Refresh environment or check health' },
      { key: ':q', description: 'Close cheatsheet / clear active focus' },
    ],
  },
  {
    category: '⌨️ Modes & Toggles',
    entries: [
      { key: 'i', description: 'Focus search or filter input (enters INSERT mode)' },
      { key: 'Esc', description: 'Leave INSERT mode / clear pending chords / close dialogs' },
      { key: '\\', description: 'Toggle Vim Navigation Mode on / off globally' },
    ],
  },
];

export const VIM_KEYMAP: VimKeymapEntry[] = VIM_KEYMAP_SECTIONS.flatMap((s) => s.entries);

const Ctx = createContext<VimCtx | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useVim = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVim must be used inside <VimProvider>');
  return v;
};

/* ========================= dom helpers ========================= */
const EDITABLE = "input, textarea, select, [contenteditable='true'], [contenteditable='']";
// Modal & dropdown blocking surfaces (tooltips/hovercards with role="tooltip" are deliberately excluded)
const OVERLAY =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], ' +
  '[data-radix-popper-content-wrapper] [role="menu"], ' +
  '[data-radix-popper-content-wrapper] [role="listbox"], ' +
  '[data-radix-popper-content-wrapper] [role="dialog"]';
const FOCUS_CLASS = 'vim-focus';
const ACTION_KEYS: Record<string, string> = {
  s: 'start',
  S: 'stop',
  l: 'logs',
  L: 'logs',
  o: 'open',
  O: 'open',
  d: 'diff',
  D: 'diff',
  c: 'commit',
  C: 'commit',
  r: 'sync',
  R: 'sync',
  f: 'refresh',
  F: 'refresh',
};
const LS_KEY = 'nf:vim-enabled';

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return !(r.width <= 0 && r.height <= 0) && s.visibility !== 'hidden' && s.display !== 'none';
};

const itemsIn = (scope: string) => {
  return [
    ...document.querySelectorAll<HTMLElement>(
      `[data-vim-scope="${scope}"] [data-vim-item], [data-vim-scope="${scope}"][data-vim-item]`,
    ),
  ].filter(visible);
};

const getActiveScroller = (scope: string): HTMLElement | null => {
  return (
    document.querySelector<HTMLElement>(`[data-vim-scope="${scope}"] [data-vim-scroll]`) ??
    document.querySelector<HTMLElement>(`[data-vim-scope="${scope}"] .overflow-auto`) ??
    document.querySelector<HTMLElement>(`[data-vim-scope="${scope}"] pre`) ??
    document.querySelector<HTMLElement>('[data-vim-scroll]') ??
    document.querySelector<HTMLElement>('main.overflow-y-auto') ??
    (document.querySelector<HTMLElement>('main')?.scrollHeight &&
    document.querySelector<HTMLElement>('main')!.scrollHeight > document.querySelector<HTMLElement>('main')!.clientHeight
      ? document.querySelector<HTMLElement>('main')
      : null)
  );
};

/* =========================== provider ========================== */
export interface VimProviderProps {
  scope: string;
  tabs: string[];
  activeTab: string;
  onSwitchTab: (tab: string) => void;
  commands?: VimCommands;
  children: ReactNode;
}

export function VimProvider(props: VimProviderProps) {
  const { scope, tabs, activeTab, onSwitchTab } = props;

  const [enabled, setEnabled] = useState(() => localStorage.getItem(LS_KEY) === 'on');
  const [mode, _setMode] = useState<VimMode>('normal');
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const onSwitchTabRef = useRef(onSwitchTab);
  onSwitchTabRef.current = onSwitchTab;
  const pendingRef = useRef(''); // chord buffer, e.g. "g"
  const countRef = useRef(''); // numeric count, e.g. "3"
  const focusedRef = useRef<HTMLElement | null>(null);
  const msgTimer = useRef<number | undefined>(undefined);

  const say = useCallback((m: string) => {
    setMessage(m);
    window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMessage(''), 2500);
  }, []);

  const setMode = useCallback((m: VimMode) => {
    _setMode(m);
    setStatus('');
    pendingRef.current = '';
    countRef.current = '';
  }, []);

  const toggle = useCallback(() => {
    setHelpOpen(false);
    setEnabled((v) => {
      const next = !v;
      localStorage.setItem(LS_KEY, next ? 'on' : 'off');
      return next;
    });
  }, []);

  /* ---- body padding class management ---- */
  useEffect(() => {
    if (enabled) {
      document.body.classList.add('vim-on');
    } else {
      document.body.classList.remove('vim-on');
    }
    return () => {
      document.body.classList.remove('vim-on');
    };
  }, [enabled]);

  /* ---- focus management ---- */
  const clearFocus = useCallback(() => {
    focusedRef.current?.classList.remove(FOCUS_CLASS);
    focusedRef.current = null;
  }, []);

  const setFocused = useCallback((el: HTMLElement | undefined | null) => {
    if (!el) return;
    focusedRef.current?.classList.remove(FOCUS_CLASS);
    el.classList.add(FOCUS_CLASS);
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    focusedRef.current = el;
  }, []);

  /* ---- clear focus on route / scope change to avoid stale detached nodes ---- */
  useEffect(() => {
    clearFocus();
  }, [scope, clearFocus]);

  const move = useCallback(
    (delta: number) => {
      const currentScope = scopeRef.current;
      // No discrete items? treat scope as a scroll region (Logs panel, markdown, page).
      const list = itemsIn(currentScope);
      if (list.length === 0) {
        const scroller = getActiveScroller(currentScope);
        if (scroller) {
          scroller.scrollTop += delta * 48;
        } else {
          window.scrollBy({ top: delta * 48, behavior: 'smooth' });
        }
        return;
      }
      const curIdx = focusedRef.current ? list.indexOf(focusedRef.current) : -1;
      let next: number;
      if (curIdx === -1) {
        next = delta > 0 ? 0 : list.length - 1;
      } else {
        // Clamped at top and bottom boundaries — no accidental wrapping restart
        next = Math.max(0, Math.min(list.length - 1, curIdx + delta));
      }
      setFocused(list[next]);
    },
    [setFocused],
  );

  /* ---- actions & commands ---- */
  const runAction = useCallback(
    (action: string) => {
      const currentScope = scopeRef.current;
      const container =
        focusedRef.current ??
        document.querySelector<HTMLElement>(`[data-vim-scope="${currentScope}"] [data-vim-selected]`) ??
        document.querySelector<HTMLElement>(`[data-vim-scope="${currentScope}"]`);
      const btn =
        container?.querySelector<HTMLElement>(`[data-vim-action="${action}"]`) ??
        [...document.querySelectorAll<HTMLElement>(`[data-vim-scope="${currentScope}"] [data-vim-action="${action}"]`)].find(visible);
      if (btn) {
        btn.click();
      } else if (props.commands?.[action]) {
        props.commands[action]();
      } else {
        say(`No action "${action}" in ${currentScope}`);
      }
    },
    [props.commands, say],
  );

  const runCommand = useCallback(
    (raw: string) => {
      const trimmed = raw.replace(/^:+/, '').trim();
      const [cmd, ...args] = trimmed.split(/\s+/);
      const arg = args.join(' ');
      if (!cmd) return;

      if (cmd === 'q' || cmd === 'quit') {
        setHelpOpen(false);
        clearFocus();
        return;
      }
      if (cmd === 'help' || cmd === 'h') {
        setHelpOpen(true);
        return;
      }
      if (cmd === 'top' || cmd === 'first' || cmd === 'head') {
        const list = itemsIn(scopeRef.current);
        if (list.length > 0) {
          setFocused(list[0]);
        } else {
          const scroller = getActiveScroller(scopeRef.current);
          if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return;
      }
      if (cmd === 'bottom' || cmd === 'last' || cmd === 'tail') {
        const list = itemsIn(scopeRef.current);
        if (list.length > 0) {
          setFocused(list[list.length - 1]);
        } else {
          const scroller = getActiveScroller(scopeRef.current);
          if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
        }
        return;
      }
      if (cmd === 'tab' && arg) {
        onSwitchTab(arg.toLowerCase());
        return;
      }
      if (cmd === 'w' || cmd === 'write') {
        runAction('commit');
        return;
      }
      if (props.commands?.[cmd]) {
        props.commands[cmd]();
        return;
      }
      if (['start', 'stop', 'logs', 'open', 'diff', 'commit', 'sync', 'refresh'].includes(cmd)) {
        runAction(cmd);
        return;
      }
      if (['overview', 'workspaces', 'projects', 'skills', 'strategies', 'settings', 'new', 'changes', 'services', 'sessions', 'knowledge', 'plan'].includes(cmd)) {
        onSwitchTab(cmd);
        return;
      }
      say(`Not an editor command: :${raw}`);
    },
    [props.commands, tabs, onSwitchTab, runAction, say, setHelpOpen, clearFocus, setFocused],
  );

  /* ---- keyboard event listener ---- */
  useEffect(() => {
    const finish = () => {
      pendingRef.current = '';
      countRef.current = '';
      setStatus('');
    };

    const onKey = (e: KeyboardEvent) => {
      // IME composition guard: ignore events when typing in IME
      if (e.isComposing || e.keyCode === 229) {
        return;
      }

      const t = e.target as HTMLElement | null;
      const inEditable = !!t?.closest?.(EDITABLE);

      if (e.key === '\\' && !inEditable) {
        toggle();
        e.preventDefault();
        return;
      }

      /* help cheatsheet overlay open: only Escape, ?, or q close it */
      if (helpOpen) {
        if (e.key === 'Escape' || e.key === '?' || e.key === 'q') {
          setHelpOpen(false);
          e.preventDefault();
        }
        return;
      }

      if (!enabled) return;

      // Radix / Modal overlay guard: if an open modal or dropdown menu is detected, suspend Vim navigation
      const isOverlayOpen = !!document.querySelector(OVERLAY);
      if (isOverlayOpen) {
        return;
      }

      /* INSERT mode: only ESC belongs to us, everything else is native typing */
      if (modeRef.current === 'insert') {
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement | null)?.blur();
          setMode('normal');
          e.preventDefault();
        }
        return;
      }

      /* caret sitting in a field in NORMAL mode: hands off, except ESC */
      if (inEditable) {
        if (e.key === 'Escape') {
          t!.blur();
          e.preventDefault();
        }
        return;
      }

      if (modeRef.current === 'command') {
        return;
      }

      /* g-chords: gg gt gT g1..g9 */
      if (pendingRef.current === 'g') {
        finish();
        if (/^[1-9]$/.test(e.key)) {
          const i = +e.key - 1;
          const t = tabsRef.current;
          if (t[i]) onSwitchTabRef.current(t[i]);
          return;
        }
        if (e.key === 't') {
          const t = tabsRef.current;
          if (t.length > 0) {
            const cur = t.indexOf(activeTabRef.current);
            const next = cur === -1 ? 0 : (cur + 1) % t.length;
            onSwitchTabRef.current(t[next]);
          }
          return;
        }
        if (e.key === 'T') {
          const t = tabsRef.current;
          if (t.length > 0) {
            const cur = t.indexOf(activeTabRef.current);
            const prev = cur === -1 ? t.length - 1 : (cur - 1 + t.length) % t.length;
            onSwitchTabRef.current(t[prev]);
          }
          return;
        }
        if (e.key === 'g') {
          const l = itemsIn(scopeRef.current);
          if (l.length > 0) {
            setFocused(l[0]);
          } else {
            const scroller = getActiveScroller(scopeRef.current);
            if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });
          }
          return;
        }
        return; // unknown chord: swallow
      }

      /* numeric count prefix: 1-9 starts a count; 0 appends if count already in progress */
      if (/^[1-9]$/.test(e.key) || (countRef.current && /^[0-9]$/.test(e.key))) {
        countRef.current += e.key;
        setStatus(countRef.current);
        return;
      }
      const count = Number(countRef.current || '1');

      switch (e.key) {
        case ':':
          setMode('command');
          e.preventDefault();
          return;
        case '?':
          setHelpOpen((v) => !v);
          e.preventDefault();
          return;
        case '\\':
          toggle();
          return;
        case 'Escape':
          setHelpOpen(false);
          clearFocus();
          finish();
          return;
        case 'g':
          pendingRef.current = 'g';
          setStatus('g');
          return;
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          move(+count);
          finish();
          return;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          move(-count);
          finish();
          return;
        case 'G': {
          const l = itemsIn(scopeRef.current);
          if (l.length > 0) {
            setFocused(l[l.length - 1]);
          } else {
            const scroller = getActiveScroller(scopeRef.current);
            if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
          }
          finish();
          return;
        }
        case 'h':
        case 'ArrowLeft': {
          e.preventDefault();
          const t = tabsRef.current;
          if (t.length > 0) {
            const cur = t.indexOf(activeTabRef.current);
            const prev = cur === -1 ? t.length - 1 : (cur - 1 + t.length) % t.length;
            onSwitchTabRef.current(t[prev]);
          }
          return;
        }
        case 'l':
        case 'ArrowRight': {
          e.preventDefault();
          const t = tabsRef.current;
          if (t.length > 0) {
            const cur = t.indexOf(activeTabRef.current);
            const next = cur === -1 ? 0 : (cur + 1) % t.length;
            onSwitchTabRef.current(t[next]);
          }
          return;
        }
        case 'Enter':
        case ' ':
          if (focusedRef.current) {
            e.preventDefault();
            focusedRef.current.click();
          }
          return;
        case 'i': {
          const inp =
            document.querySelector<HTMLInputElement>(`[data-vim-scope="${scopeRef.current}"] [data-vim-search]`) ??
            document.querySelector<HTMLInputElement>('[data-vim-search]') ??
            focusedRef.current?.querySelector<HTMLInputElement>('input, textarea');
          if (inp) {
            inp.focus();
            setMode('insert');
            e.preventDefault();
          }
          return;
        }
        case 'd':
        case 'u':
          if (e.ctrlKey) {
            const scroller = getActiveScroller(scopeRef.current);
            const amount =
              (scroller?.clientHeight ? scroller.clientHeight / 2 : innerHeight / 2) * (e.key === 'd' ? 1 : -1);
            if (scroller) {
              scroller.scrollBy({ top: amount, behavior: 'smooth' });
            } else {
              window.scrollBy({ top: amount, behavior: 'smooth' });
            }
            e.preventDefault();
            return;
          }
          break;
      }

      const action = ACTION_KEYS[e.key];
      if (action && !e.ctrlKey && !e.metaKey && !e.altKey) {
        runAction(action);
        finish();
      } else {
        finish();
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [
    enabled,
    scope,
    tabs,
    activeTab,
    helpOpen,
    move,
    setFocused,
    clearFocus,
    runAction,
    runCommand,
    setMode,
    toggle,
    onSwitchTab,
  ]);

  return (
    <Ctx.Provider
      value={{
        enabled,
        toggle,
        mode,
        setMode,
        status,
        scope,
        message,
        say,
        helpOpen,
        setHelpOpen,
      }}
    >
      {props.children}
      {enabled && <StatusLine onRunCommand={runCommand} />}
    </Ctx.Provider>
  );
}

/* ========================== status line ======================== */
function StatusLine({ onRunCommand }: { onRunCommand: (cmd: string) => void }) {
  const vim = useVim();
  const label = { normal: 'NORMAL', insert: 'INSERT', command: 'COMMAND' }[vim.mode];
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (vim.mode === 'command') {
      inputRef.current?.focus();
    }
  }, [vim.mode]);

  return (
    <div className="vim-statusline" data-mode={vim.mode}>
      <span className={`badge badge-${vim.mode}`}>{label}</span>
      <span className="font-semibold text-foreground/80">{vim.scope}</span>
      {vim.status && <span className="pending">{vim.status}</span>}
      {vim.message && (
        <span className="error" role="status" aria-live="polite">
          {vim.message}
        </span>
      )}
      {vim.mode === 'command' && (
        <input
          ref={inputRef}
          className="vim-cmdline"
          spellCheck={false}
          placeholder=":help  :top  :bottom  :start  :stop  :logs  :diff  :commit  :sync  :refresh  :tab <name>  :q"
          onBlur={() => {
            vim.setMode('normal');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              vim.setMode('normal');
              e.preventDefault();
            } else if (e.key === 'Enter') {
              onRunCommand((e.target as HTMLInputElement).value);
              vim.setMode('normal');
              e.preventDefault();
            }
          }}
        />
      )}
      <span className="spacer" />
      <div className="hint">
        <button
          type="button"
          onClick={() => vim.setHelpOpen(true)}
          className="vim-btn-hint"
          title="Open Vim commands cheatsheet (?)"
        >
          ? Help
        </button>
        <button
          type="button"
          onClick={vim.toggle}
          className="vim-btn-hint"
          title="Toggle Vim Mode (\)"
        >
          \ {vim.enabled ? 'VIM: ON' : 'VIM: OFF'}
        </button>
      </div>
    </div>
  );
}

/* ====================== optional help overlay ================== */
export function VimHelp() {
  const { helpOpen, setHelpOpen } = useVim();
  if (!helpOpen) return null;

  return (
    <div
      className="vim-help-backdrop"
      onClick={() => setHelpOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Vim Keybindings & Commands Cheatsheet"
    >
      <div className="vim-help" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
          <div>
            <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
              NexusFlow — Vim Navigation & Commands
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Press <Kbd>Esc</Kbd> or click ✕ to close. Press <Kbd>\</Kbd> anytime to toggle Vim mode.
            </p>
          </div>
          <button
            onClick={() => setHelpOpen(false)}
            aria-label="Close help"
            className="text-muted-foreground hover:text-foreground text-xs cursor-pointer p-1 rounded hover:bg-accent"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          {VIM_KEYMAP_SECTIONS.map((section) => (
            <div key={section.category} className="border-b border-border/50 pb-2.5 last:border-b-0">
              <div className="vim-help-category">{section.category}</div>
              <table className="w-full">
                <tbody>
                  {section.entries.map((entry) => (
                    <tr key={entry.key} className="hover:bg-accent/20 rounded">
                      <td className="py-0.5 pr-3 text-xs font-mono w-44">
                        <Kbd>{entry.key}</Kbd>
                      </td>
                      <td className="py-0.5 text-xs text-foreground/90">{entry.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
