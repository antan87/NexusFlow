import type { HTMLAttributes } from 'react';
import { cn } from './cn.js';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('bg-surface/90 backdrop-blur-md border border-hairline rounded-xl shadow-md overflow-hidden', className)} {...rest} />;
}
