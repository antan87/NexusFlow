import React from 'react';
import { cn } from '../../lib/utils.js';

export interface ContextSpaceIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  className?: string;
}

export function ContextSpaceIcon({ size = 24, className, ...props }: ContextSpaceIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 200"
      fill="none"
      width={size}
      height={size}
      className={cn('shrink-0 select-none', className)}
      {...props}
    >
      <defs>
        <linearGradient id="csi-bg" x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1A1426" />
          <stop offset="50%" stopColor="#0F0C18" />
          <stop offset="100%" stopColor="#06040A" />
        </linearGradient>
        <linearGradient id="csi-sunset" x1="40" y1="20" x2="160" y2="180" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FDE047" />
          <stop offset="30%" stopColor="#FB923C" />
          <stop offset="65%" stopColor="#F43F5E" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
        <linearGradient id="csi-rim" x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FDE047" stopOpacity="0.6" />
          <stop offset="50%" stopColor="#F43F5E" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#6366F1" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* Plate */}
      <rect width="200" height="200" rx="44" fill="url(#csi-bg)" />
      <rect x="1" y="1" width="198" height="198" rx="43" stroke="url(#csi-rim)" strokeWidth="1.5" />

      {/* Outer Hexagonal 'C' Chassis (Uniform 18px width) */}
      <path d="M100 28 L154 59 L136 70 L100 49 L58 73 L58 127 L100 151 L136 130 L154 141 L100 172 L40 137 L40 63 Z" fill="url(#csi-sunset)" />

      {/* Inner Angular 'W' (Workspace) in Pure Alpine White */}
      <path d="M74 72 L90 72 L103 118 L116 84 L128 84 L141 118 L154 72 L170 72 L152 134 L136 134 L122 98 L108 134 L92 134 Z" fill="#FFFFFF" />

      {/* 3 Clean Diagonal Speed Cuts */}
      <path d="M106 20 L188 102 L180 110 L98 28 Z" fill="#06040A" />
      <path d="M68 52 L150 134 L142 142 L60 60 Z" fill="#06040A" />
      <path d="M38 92 L120 174 L112 182 L30 100 Z" fill="#06040A" />

      {/* Precision Needle Speed Trails */}
      <path d="M106 20 L138 -12" stroke="#FDE047" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M174 88 L206 56" stroke="#FB923C" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M54 66 L22 98" stroke="#F43F5E" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M134 118 L168 84" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
      <path d="M32 106 L0 138" stroke="#6366F1" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
