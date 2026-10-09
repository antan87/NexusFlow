import { Check } from 'lucide-react';
import { HarnessIcon, harnessName } from '../../components/icons/HarnessIcon.js';
import { cn } from '../../lib/utils.js';
import type { DetectedAI } from '../../types.js';

const KEYS_BACKWARD = ['ArrowLeft', 'ArrowUp'];
const KEYS_FORWARD = ['ArrowRight', 'ArrowDown'];

/**
 * Which tool the new workspace opens with. Choosing one only puts it first on
 * the CLI start screen: nothing is started until the developer presses it.
 * Tools that are not installed are shown, but cannot be chosen.
 */
export function HarnessPicker({ harnesses, value, onChange, loading }: {
  harnesses: DetectedAI[];
  /** The chosen harness id, or '' for none yet. */
  value: string;
  onChange: (harness: string) => void;
  loading: boolean;
}) {
  const installed = harnesses.filter((harness) => harness.detected);
  // One tab stop for the group: the chosen card, else the first one that can be chosen.
  const tabStop = installed.find((harness) => harness.name === value)?.name ?? installed[0]?.name;

  const move = (from: string, step: 1 | -1) => {
    const index = installed.findIndex((harness) => harness.name === from);
    const next = installed[(index + step + installed.length) % installed.length];
    if (!next) return;
    onChange(next.name);
    document.getElementById(`harness-${next.name}`)?.focus();
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <span id="harness-picker-label" className="text-sm font-medium">Start with</span>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="rounded text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Choose later
          </button>
        )}
      </div>
      <p id="harness-picker-hint" className="mb-2 text-xs text-muted-foreground">
        Opens first on the next screen. Nothing starts until you press it.
      </p>

      {loading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="status" aria-label="Looking for installed AI tools">
          {[0, 1, 2].map((slot) => <div key={slot} className="h-[62px] animate-pulse rounded-xl border border-border bg-muted/40" />)}
        </div>
      ) : harnesses.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          No AI command-line tools were found on this machine.
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-labelledby="harness-picker-label"
          aria-describedby="harness-picker-hint"
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          onKeyDown={(event) => {
            const from = (event.target as HTMLElement).id.replace(/^harness-/, '');
            if (KEYS_FORWARD.includes(event.key)) { event.preventDefault(); move(from, 1); }
            if (KEYS_BACKWARD.includes(event.key)) { event.preventDefault(); move(from, -1); }
          }}
        >
          {harnesses.map((harness) => {
            const selected = harness.name === value;
            const statusId = `harness-${harness.name}-status`;
            return (
              <button
                key={harness.name}
                id={`harness-${harness.name}`}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={harnessName(harness.name)}
                aria-describedby={statusId}
                disabled={!harness.detected}
                tabIndex={harness.name === tabStop ? 0 : -1}
                onClick={() => onChange(harness.name)}
                className={cn(
                  'relative flex min-w-0 items-center gap-3 rounded-xl border p-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card',
                  harness.detected
                    ? 'cursor-pointer hover:border-foreground/25'
                    : 'cursor-not-allowed opacity-60',
                )}
              >
                <span
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
                    selected ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted/50 text-foreground',
                  )}
                >
                  <HarnessIcon harness={harness.name} className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{harnessName(harness.name)}</span>
                  <span id={statusId} className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', harness.detected ? 'bg-success' : 'bg-muted-foreground/40')} />
                    {harness.detected ? 'Installed' : 'Not installed'}
                  </span>
                </span>
                {selected && (
                  <span aria-hidden="true" className="absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
