import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from './cn.js';

const base =
  'w-full bg-base border border-hairline rounded-md px-3 py-2 text-sm text-content placeholder:text-content-faint outline-none focus:border-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, 'resize-y leading-relaxed', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(base, 'cursor-pointer', className)} {...rest}>
      {children}
    </select>
  );
}
