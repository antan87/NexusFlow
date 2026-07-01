import type { HTMLAttributes } from 'react';
import { cn } from './cn.js';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('bg-surface border border-hairline rounded-lg', className)} {...rest} />;
}
