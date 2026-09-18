/**
 * ChangesetSymbolNavigator Component
 * Quick search palette & explorer for symbols (classes, interfaces, functions, types, enums)
 * across changed files in the active review changeset.
 * File: gui/src/features/changes/ChangesetSymbolNavigator.tsx
 */
import React, { useState, useMemo } from 'react';
import {
  Search,
  ExternalLink,
  Code2,
  X,
  Filter,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';
import type { ChangesetSymbol, SymbolKindLabel } from './utils/changesetSymbolIndex.js';

export interface ChangesetSymbolNavigatorProps {
  symbols: ChangesetSymbol[];
  activeFilePath?: string;
  activeLine?: number;
  editorLabel?: string;
  onSelectSymbol: (symbol: ChangesetSymbol) => void;
  onOpenInVsCode?: (symbol: ChangesetSymbol) => void;
  onClose?: () => void;
  className?: string;
}

type FilterCategory = 'all' | 'modified' | SymbolKindLabel;

const CATEGORY_PILLS: { id: FilterCategory; label: string; short: string }[] = [
  { id: 'all', label: 'All', short: 'All' },
  { id: 'modified', label: 'Modified Only', short: 'Mod' },
  { id: 'function', label: 'Functions', short: 'fn' },
  { id: 'class', label: 'Classes', short: 'cls' },
  { id: 'interface', label: 'Interfaces', short: 'iface' },
  { id: 'type', label: 'Types', short: 'type' },
  { id: 'enum', label: 'Enums', short: 'enum' },
  { id: 'variable', label: 'Variables', short: 'var' },
];

export const ChangesetSymbolNavigator: React.FC<ChangesetSymbolNavigatorProps> = ({
  symbols,
  activeFilePath,
  activeLine,
  editorLabel = 'VS Code',
  onSelectSymbol,
  onOpenInVsCode,
  onClose,
  className,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<FilterCategory>('all');

  const filteredSymbols = useMemo(() => {
    let result = symbols;

    // Filter by Category
    if (activeCategory === 'modified') {
      result = result.filter((s) => s.isModifiedInChangeset);
    } else if (activeCategory !== 'all') {
      result = result.filter((s) => s.kindLabel === activeCategory);
    }

    // Filter by Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.filePath.toLowerCase().includes(q) ||
          s.kindLabel.toLowerCase().includes(q)
      );
    }

    // Sort: modified first, then by filePath, then by lineNumber
    return result.sort((a, b) => {
      if (a.isModifiedInChangeset !== b.isModifiedInChangeset) {
        return a.isModifiedInChangeset ? -1 : 1;
      }
      if (a.filePath !== b.filePath) {
        return a.filePath.localeCompare(b.filePath);
      }
      return a.lineNumber - b.lineNumber;
    });
  }, [symbols, activeCategory, searchQuery]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: symbols.length,
      modified: symbols.filter((s) => s.isModifiedInChangeset).length,
    };
    for (const s of symbols) {
      counts[s.kindLabel] = (counts[s.kindLabel] || 0) + 1;
    }
    return counts;
  }, [symbols]);

  const getKindBadgeClass = (kind: SymbolKindLabel) => {
    switch (kind) {
      case 'class':
        return 'border-purple-500/40 bg-purple-500/15 text-purple-400';
      case 'interface':
        return 'border-sky-500/40 bg-sky-500/15 text-sky-400';
      case 'function':
        return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400';
      case 'type':
        return 'border-amber-500/40 bg-amber-500/15 text-amber-400';
      case 'enum':
        return 'border-pink-500/40 bg-pink-500/15 text-pink-400';
      case 'variable':
        return 'border-teal-500/40 bg-teal-500/15 text-teal-400';
      default:
        return 'border-border bg-muted text-muted-foreground';
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-border/90 bg-card/95 backdrop-blur-md shadow-lg overflow-hidden text-xs',
        className
      )}
    >
      {/* ─── PALETTE HEADER ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border/70 bg-muted/25">
        <div className="flex items-center gap-2 min-w-0">
          <Code2 size={14} className="text-primary shrink-0" />
          <span className="font-mono text-xs font-bold text-foreground">Changeset Symbols</span>
          <span className="rounded-full bg-primary/10 border border-primary/20 px-1.5 py-0.2 font-mono text-[10px] text-primary font-semibold">
            {filteredSymbols.length} / {symbols.length}
          </span>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors cursor-pointer"
            title="Close Symbol Navigator"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* ─── SEARCH & FILTER ROW ────────────────────────────────────────────── */}
      <div className="p-2 space-y-2 border-b border-border/60 bg-background/50">
        <div className="relative flex items-center">
          <Search size={13} className="absolute left-2.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search functions, classes, types, files..."
            className="w-full rounded-lg border border-border bg-background/90 pl-8 pr-7 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 text-muted-foreground hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none select-none">
          <Filter size={11} className="text-muted-foreground shrink-0 ml-0.5 mr-0.5" />
          {CATEGORY_PILLS.map((pill) => {
            const count = categoryCounts[pill.id] || 0;
            const isSelected = activeCategory === pill.id;
            if (pill.id !== 'all' && pill.id !== 'modified' && count === 0) return null;

            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setActiveCategory(pill.id)}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10px] transition-colors cursor-pointer shrink-0 border',
                  isSelected
                    ? 'border-primary/50 bg-primary/15 text-primary font-bold'
                    : 'border-border/60 bg-card hover:bg-accent text-muted-foreground hover:text-foreground'
                )}
              >
                <span>{pill.label}</span>
                <span className="text-[9px] opacity-70">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── SYMBOL LIST RESULTS ────────────────────────────────────────────── */}
      <div className="max-h-64 overflow-y-auto divide-y divide-border/40 scrollbar-thin">
        {symbols.length === 0 ? (
          <div className="py-8 px-4 text-center text-muted-foreground">
            <p className="font-mono text-xs font-semibold text-foreground">No code symbols detected in this changeset</p>
            <p className="text-[11px] mt-1.5 max-w-sm mx-auto text-muted-foreground/80 leading-relaxed">
              Symbols (functions, classes, interfaces, types, enums, variables) are automatically extracted from modified code files in supported languages (TypeScript, JavaScript, Python, Go, Rust).
            </p>
          </div>
        ) : filteredSymbols.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <p className="font-mono text-xs">No symbols match "{searchQuery || activeCategory}"</p>
            <p className="text-[10px] mt-1 text-muted-foreground/70">
              Try searching by name or selecting "All"
            </p>
          </div>
        ) : (
          filteredSymbols.map((s) => {
            const isCurrentFile = activeFilePath && s.filePath.endsWith(activeFilePath);
            const isCurrentLine = isCurrentFile && activeLine === s.lineNumber;

            return (
              <div
                key={s.id}
                onClick={() => onSelectSymbol(s)}
                className={cn(
                  'group flex items-center justify-between gap-2 px-3 py-2 cursor-pointer transition-colors',
                  isCurrentLine
                    ? 'bg-primary/15 border-l-2 border-l-primary'
                    : 'hover:bg-accent/50'
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {/* Kind Badge */}
                  <span
                    className={cn(
                      'px-1.5 py-0.2 rounded font-mono text-[9px] font-bold border uppercase shrink-0',
                      getKindBadgeClass(s.kindLabel)
                    )}
                  >
                    {s.kindLabel.slice(0, 4)}
                  </span>

                  {/* Symbol Name */}
                  <span className="font-mono text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors">
                    {s.name}
                  </span>

                  {/* Modified In Changeset Indicator */}
                  {s.isModifiedInChangeset && (
                    <span
                      className={cn(
                        'px-1 py-0.2 rounded font-mono text-[9px] font-bold border shrink-0',
                        s.changeType === 'added'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      )}
                      title={s.changeType === 'added' ? 'Added in this changeset' : 'Modified in this changeset'}
                    >
                      {s.changeType === 'added' ? '+add' : '~mod'}
                    </span>
                  )}
                </div>

                {/* Right Side: File, Line, Hunk, and External VS Code Link */}
                <div className="flex items-center gap-2 shrink-0 font-mono text-[10px] text-muted-foreground">
                  <span className="truncate max-w-[150px] text-muted-foreground/80" title={s.filePath}>
                    {s.filePath.split('/').pop()}
                  </span>
                  <span className="text-foreground/70">:{s.lineNumber}</span>

                  {s.hunkIndex !== undefined && (
                    <span className="bg-muted px-1 rounded text-[9px] border border-border/40">
                      H#{s.hunkIndex + 1}
                    </span>
                  )}

                  {isCurrentLine && (
                    <CheckCircle2 size={12} className="text-primary shrink-0" />
                  )}

                  {onOpenInVsCode && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenInVsCode(s);
                      }}
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
                      title={`Open symbol definition in desktop ${editorLabel}`}
                    >
                      <ExternalLink size={11} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
