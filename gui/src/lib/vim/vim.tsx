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
  action: string;
  description: string;
}

export const VIM_KEYMAP: VimKeymapEntry[] = [
  { key: 'j / k', action: 'next / previous item', description: 'next / previous item in active view (prefix count: 3j)' },
  { key: 'h / l', action: 'previous / next tab', description: 'previous / next tab' },
  { key: 'gg / G', action: 'first / last item', description: 'first / last item in active view' },
  { key: 'gt / gT / g1–g9', action: 'cycle / jump to tab', description: 'cycle forward / backward or jump to tab 1–9' },
  { key: 'Enter / Space', action: 'activate focused item', description: 'activate focused item' },
  { key: 'i', action: 'filter / edit', description: 'focus nearest filter or search input (ESC returns)' },
  { key: 's S L o d c r f', action: 'workspace actions', description: 'start · stop · logs · open · diff · commit · sync · refresh' },
  { key: ':', action: 'command line', description: 'command line prompt (:help :start :logs :tab … :q)' },
  { key: 'Ctrl+d / Ctrl+u', action: 'scroll half page', description: 'scroll down / up half page' },
  { key: '?', action: 'keybinding cheatsheet', description: 'toggle keybinding cheatsheet overlay' },
  { key: 'Esc / \\', action: 'normal mode / toggle', description: 'normal mode / toggle vim navigation on/off' },
];

const Ctx = createContext<VimCtx | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useVim = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVim must be used inside <VimProvider>');
  return v;
};

/* ========================= dom helpers ========================= */
const EDITABLE = "input, textarea, select, [contenteditable='true'], [contenteditable='']";
const OVERLAY =
  '[role="dialog"][data-state="open"], [data-radix-popper-content-wrapper], [data-portal], [role="alertdialog"][data-state="open"]';
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
  const scoped = [
    ...document.querySelectorAll<HTMLElement>(
      `[data-vim-scope="${scope}"] [data-vim-item], [data-vim-scope="${scope}"][data-vim-item]`,
    ),
  ].filter(visible);
  if (scoped.length > 0) return scoped;
  return [...document.querySelectorAll<HTMLElement>('[data-vim-item]')].filter(visible);
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

  const [enabled, setEnabled] = useState(() => localStorage.getItem(LS_KEY) !== 'off');
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
      // No discrete items? treat scope as a scroll region (Logs panel).
      const list = itemsIn(scope);
      if (list.length === 0) {
        const scroller = document.querySelector<HTMLElement>(
          `[data-vim-scope="${scope}"] [data-vim-scroll], [data-vim-scroll]`,
        );
        if (scroller) scroller.scrollTop += delta * 32;
        return;
      }
      const curIdx = focusedRef.current ? list.indexOf(focusedRef.current) : -1;
      let next: number;
      if (curIdx === -1) {
        next = delta > 0 ? (delta - 1) % list.length : (((delta % list.length) + list.length) % list.length);
      } else {
        next = (((curIdx + delta) % list.length) + list.length) % list.length;
      }
      setFocused(list[next]);
    },
    [scope, setFocused],
  );

  /* ---- actions & commands ---- */
  const runAction = useCallback(
    (action: string) => {
      const currentScope = scopeRef.current;
      const container =
        focusedRef.current ??
        document.querySelector<HTMLElement>('[data-vim-selected]') ??
        document.querySelector<HTMLElement>(`[data-vim-scope="${currentScope}"]`);
      const btn =
        container?.querySelector<HTMLElement>(`[data-vim-action="${action}"]`) ??
        document.querySelector<HTMLElement>(`[data-vim-action="${action}"]`);
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
      if (cmd === 'tab' && arg) {
        const lowerArg = arg.toLowerCase();
        const matched = tabs.find((t) => t.toLowerCase() === lowerArg);
        if (matched) {
          onSwitchTab(matched);
        } else {
          say(`No such tab: ${arg}`);
        }
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
      say(`Not an editor command: :${raw}`);
    },
    [props.commands, tabs, onSwitchTab, runAction, say, setHelpOpen, clearFocus],
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

      if (!enabled) return;

      /* help cheatsheet overlay open: only Escape or ? close it, suspend normal navigation */
      if (helpOpen) {
        if (e.key === 'Escape' || e.key === '?' || e.key === 'q') {
          setHelpOpen(false);
          e.preventDefault();
        }
        return;
      }

      // Radix / Modal overlay guard: if an open modal or dialog is detected, suspend Vim navigation
      const isOverlayOpen = !!document.querySelector(OVERLAY);
      if (isOverlayOpen) {
        if (e.key === 'Escape') return; // let modal / Radix close natively
        return; // suspend NORMAL mode navigation & actions
      }

      /* INSERT mode: only ESC belongs to us, everything else is typing */
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
          t?.blur();
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
        const t = tabsRef.current;
        const curTab = activeTabRef.current;
        const switchTab = onSwitchTabRef.current;
        if (/^[1-9]$/.test(e.key)) {
          const i = +e.key - 1;
          if (t[i]) switchTab(t[i]);
          return;
        }
        if (e.key === 't') {
          if (t.length > 0) {
            const cur = t.indexOf(curTab);
            const next = cur === -1 ? 0 : (cur + 1) % t.length;
            switchTab(t[next]);
          }
          return;
        }
        if (e.key === 'T') {
          if (t.length > 0) {
            const cur = t.indexOf(curTab);
            const prev = cur === -1 ? t.length - 1 : (cur - 1 + t.length) % t.length;
            switchTab(t[prev]);
          }
          return;
        }
        if (e.key === 'g') {
          const items = itemsIn(scopeRef.current);
          if (items.length > 0) setFocused(items[0]);
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
          if (l.length > 0) setFocused(l[l.length - 1]);
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
            document.querySelector<HTMLInputElement>(`[data-vim-scope="${scope}"] [data-vim-search]`) ??
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
            window.scrollBy({ top: (window.innerHeight / 2) * (e.key === 'd' ? 1 : -1), behavior: 'smooth' });
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
          placeholder=":help  :start  :stop  :logs  :diff  :commit  :sync  :refresh  :tab <name>  :q"
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
      <span className="hint">? keys · \ vim toggle</span>
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
      aria-label="Vim Keybindings Cheatsheet"
    >
      <div className="vim-help" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
          <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
            NexusFlow — Vim Keys <Kbd>Esc</Kbd>
          </h3>
          <button
            onClick={() => setHelpOpen(false)}
            aria-label="Close help"
            className="text-muted-foreground hover:text-foreground text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>
        <table className="w-full">
          <tbody>
            {VIM_KEYMAP.map((entry) => (
              <tr key={entry.key}>
                <td className="py-1 pr-3 text-xs font-mono">
                  <Kbd>{entry.key}</Kbd>
                </td>
                <td className="py-1 text-xs text-foreground/90">{entry.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
