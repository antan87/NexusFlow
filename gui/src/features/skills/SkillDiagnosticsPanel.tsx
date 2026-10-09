import type { SkillDiagnosticItem } from '../../types.js';

/**
 * Skills that did not load, or loaded with something to fix, and what to do about each. Shown on
 * the global Skills page and on a workspace's Skills tab, so a skill that "doesn't work" is never
 * silent in one place and explained in the other.
 */
export function SkillDiagnosticsPanel({ diagnostics }: { diagnostics: SkillDiagnosticItem[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <div role="status" className="rounded-lg border border-amber-500/40 p-4 text-sm">
      <h4 className="font-semibold">Skill discovery notices</h4>
      <ul className="mt-2 space-y-2">
        {diagnostics.map((item, index) => (
          <li key={`${item.scope}-${item.id}-${index}`}>
            <strong>{item.id}</strong> ({item.scope}){item.level === 'warning' ? '' : ' — not loaded'}: {item.message}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        You can also check from a terminal with <code>ctxspace skills lint</code>.
      </p>
    </div>
  );
}
