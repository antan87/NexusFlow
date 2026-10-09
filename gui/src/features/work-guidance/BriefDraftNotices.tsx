import { Button } from '../../components/ui/button.js';
import { Textarea } from '../../components/ui/textarea.js';
import type { DraftDifference } from './briefDrafts.js';

export type DraftState = 'saved' | 'unsaved' | 'saving' | 'conflict';

/** Saved / Unsaved / Saving / Conflict. A polite live region without a role, so it never competes with the page's status message. */
export function DraftStateLabel({ state, kept, keptText = 'Unsaved changes — kept on this device' }: { state: DraftState; /** False when the draft could not be stored. */ kept: boolean; keptText?: string }) {
  const text = state === 'saved' ? 'Saved'
    : state === 'saving' ? 'Saving…'
      : state === 'conflict' ? 'Conflict — review the saved version before editing'
        : kept ? keptText : 'Unsaved changes — not kept, save before you leave';
  return <span aria-live="polite" data-draft-state={state} className="text-xs text-muted-foreground">{text}</span>;
}

const shown = (value: string) => value.trim() ? (value.length > 240 ? `${value.slice(0, 240)}…` : value) : '(empty)';

/** A saved version appeared while an older draft was kept. Nothing is applied until the user chooses. */
export function DraftConflictNotice({ noun, differences, onKeep, onUseSaved }: { noun: string; differences: DraftDifference[]; onKeep: () => void; onUseSaved: () => void }) {
  return <section aria-label={`Unsaved ${noun} edits conflict`} className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
    <h4 className="text-sm font-semibold">Your unsaved {noun} edits conflict with a newer saved version</h4>
    <p className="text-xs text-muted-foreground">The {noun} was saved again after you started editing. Your edits are kept on this device and have not replaced anything. Below is where they differ from what was saved; choose which to continue with.</p>
    <dl className="space-y-2 text-xs">{differences.map((difference) => <div key={difference.label}>
      <dt className="font-medium">{difference.label}</dt>
      <dd className="whitespace-pre-wrap break-words">Yours: {shown(difference.draft)}</dd>
      <dd className="whitespace-pre-wrap break-words text-muted-foreground">Saved: {shown(difference.saved)}</dd>
    </div>)}</dl>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={onKeep}>Keep my {noun} edits</Button>
      <Button size="sm" variant="outline" onClick={onUseSaved}>Use the saved {noun}</Button>
    </div>
  </section>;
}

/** Delivery notes are one document, so the two versions are shown whole, side by side, rather than field by field. */
export function NotesConflictNotice({ mine, saved, onKeep, onUseSaved }: { mine: string; saved: string; onKeep: () => void; onUseSaved: () => void }) {
  return <section aria-label="Unsaved delivery notes conflict" className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
    <h4 className="text-sm font-semibold">Your unsaved delivery notes conflict with a newer saved version</h4>
    <p className="text-xs text-muted-foreground">The delivery notes were saved again after you started editing. Your edits are kept on this device and have not replaced anything. Read both, then choose which to continue with.</p>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="block text-xs font-medium">Your unsaved delivery notes<Textarea readOnly rows={10} className="mt-1 font-mono text-xs" value={mine} /></label>
      <label className="block text-xs font-medium">Latest saved delivery notes<Textarea readOnly rows={10} className="mt-1 font-mono text-xs" value={saved} /></label>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={onKeep}>Keep my delivery notes</Button>
      <Button size="sm" variant="outline" onClick={onUseSaved}>Use the saved delivery notes</Button>
    </div>
  </section>;
}
