import { useId, type SVGProps } from 'react';
import { cn } from '../../lib/utils.js';

export interface ContextSpaceIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}

/** Open Context: one clear C, with room at the center. */
export function ContextSpaceIcon({ size = 24, className, ...props }: ContextSpaceIconProps) {
  const gradientId = `context-gradient-${useId().replace(/:/g, '')}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 200"
      fill="none"
      width={size}
      height={size}
      aria-hidden={props['aria-label'] ? undefined : true}
      role={props['aria-label'] ? 'img' : undefined}
      className={cn('context-logo shrink-0 select-none', className)}
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="30" y1="20" x2="160" y2="180" gradientUnits="userSpaceOnUse">
          <stop className="context-logo-stop-first" offset="0%" />
          <stop className="context-logo-stop-middle" offset="50%" />
          <stop className="context-logo-stop-last" offset="100%" />
        </linearGradient>
      </defs>
      <path
        className="context-logo-mark"
        d="M 178.8 63.3 A 87 87 0 1 0 178.8 136.7 L 141.7 119.4 A 46 46 0 1 1 141.7 80.6 Z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  );
}
