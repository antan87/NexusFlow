import { AlertCircle, CheckCircle2, FolderOpen } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Spinner } from '../../components/ui/spinner.js';
import { cn } from '../../lib/utils.js';
import { desktopFolderPicker, type FolderCheck } from './setupApi.js';

interface FolderFieldProps {
  id: string;
  label: string;
  description: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  /** Called when the user leaves the field or picks a folder. */
  onCommit: (value: string) => void;
  check?: FolderCheck | null;
  checking?: boolean;
  /** Text shown when the folder is fine (e.g. the repositories found). */
  okText?: string;
  /** Replaces the message for a missing folder that will be created. */
  missingText?: string;
  disabled?: boolean;
}

/**
 * A labelled folder input with inline validation. The label, help and status
 * are wired to the input so assistive technology reads all three.
 */
export function FolderField({ id, label, description, value, placeholder, onChange, onCommit, check, checking, okText, missingText, disabled }: FolderFieldProps) {
  const pick = desktopFolderPicker();
  const descriptionId = `${id}-description`;
  const statusId = `${id}-status`;
  const problem = check && check.status !== 'ok' && !(check.status === 'missing' && missingText);
  const message = checking
    ? 'Checking folder…'
    : !check ? ''
      : check.status === 'ok' ? okText ?? ''
        : check.status === 'missing' && missingText ? missingText
          : check.message;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
      <p id={descriptionId} className="text-xs text-muted-foreground">{description}</p>
      <div className="flex gap-2">
        <Input
          id={id}
          type="text"
          spellCheck={false}
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={problem ? true : undefined}
          aria-describedby={`${descriptionId} ${statusId}`}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onCommit(event.target.value)}
        />
        {pick && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={`Browse for ${label.toLowerCase()}`}
            onClick={async () => {
              const chosen = await pick(value || undefined);
              if (chosen) { onChange(chosen); onCommit(chosen); }
            }}
          >
            <FolderOpen size={14} />Browse…
          </Button>
        )}
      </div>
      <p id={statusId} className={cn('flex min-h-4 items-center gap-1.5 text-xs', problem ? 'text-destructive' : 'text-muted-foreground')}>
        {checking ? <Spinner className="size-3" /> : problem ? <AlertCircle aria-hidden="true" size={12} /> : message ? <CheckCircle2 aria-hidden="true" size={12} className="text-success" /> : null}
        {message}
      </p>
    </div>
  );
}
