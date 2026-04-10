'use client';

import type { ReactNode } from 'react';

type SelectablePreviewCardProps = {
  onClick: () => void;
  isSelected: boolean;
  disabled?: boolean;
  label: string;
  subtitle?: string;
  badge: string;
  durationBadge?: string;
  thumbnail: ReactNode;
  loadingIndicator?: ReactNode;
};

export function SelectablePreviewCard({
  onClick,
  isSelected,
  disabled = false,
  label,
  subtitle,
  badge,
  durationBadge,
  thumbnail,
  loadingIndicator,
}: SelectablePreviewCardProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      className={`text-left bg-[#1c1b1b] border border-[#3a494b]/30 hover:border-[#00f3ff]/60 group transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
        isSelected ? 'border-l-2 border-l-[#fe00fe] neon-glow-secondary' : ''
      }`}>
      <div className='relative aspect-video bg-black overflow-hidden'>
        {thumbnail}
        <div className='absolute inset-0 scanline opacity-30' />
        <div className='absolute top-1.5 left-1.5 px-1 bg-black/80 text-[10px] font-mono text-[#00f3ff] border border-[#00f3ff]/30'>
          {badge}
        </div>
        {durationBadge && (
          <div className='absolute bottom-1.5 right-1.5 px-1 bg-black/80 text-[10px] font-mono text-[#fe00fe]'>
            {durationBadge}
          </div>
        )}
        {loadingIndicator && (
          <div className='absolute inset-0 flex items-center justify-center bg-black/45'>
            {loadingIndicator}
          </div>
        )}
      </div>
      <div className='p-2 border-t border-[#3a494b]/20'>
        <div className='font-mono text-[11px] text-[#e3fdff] mb-0.5 truncate'>
          {label}
        </div>
        {subtitle && (
          <div className='font-mono text-[10px] text-[#849495] truncate'>
            {subtitle}
          </div>
        )}
      </div>
    </button>
  );
}
