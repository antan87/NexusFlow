import React from 'react';
import antigravityLogo from '../../assets/antigravity-logo.png';
import { cn } from '../../lib/utils.js';

export interface AntigravityIconProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  className?: string;
  size?: number | string;
}

export function AntigravityIcon({ className, size, alt = 'Google Antigravity', ...props }: AntigravityIconProps) {
  return (
    <img
      src={antigravityLogo}
      alt={alt}
      className={cn('inline-block object-contain select-none shrink-0', className)}
      style={size ? { width: size, height: size } : undefined}
      {...props}
    />
  );
}
