import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fadeIn2 } from '@/utils/animations';
import { motion } from 'framer-motion';
import { Grid3X3, Layers, LayoutGrid, LucideIcon, Square } from 'lucide-react';

export type Layout =
  | 'grid'
  | 'primary-on-left'
  | 'primary-on-top'
  | 'picture-in-picture'
  | 'wrapped'
  | 'wrapped-static'
  | 'transition'
  | 'picture-on-picture'
  | 'softu-tv';

type LayoutConfig = {
  id: Layout;
  name: string;
  icon: LucideIcon;
  maxStreams: number;
};

export const LAYOUT_CONFIGS = [
  {
    id: 'primary-on-left',
    name: 'Primary Left',
    icon: LayoutGrid,
    maxStreams: 4,
  },
  { id: 'grid', name: 'Grid', icon: Grid3X3, maxStreams: 4 },
  { id: 'primary-on-top', name: 'Primary Top', icon: Square, maxStreams: 4 },
  {
    id: 'picture-in-picture',
    name: 'Picture in Picture',
    icon: LayoutGrid,
    maxStreams: 4,
  },
  { id: 'wrapped', name: 'Wrapped', icon: Grid3X3, maxStreams: 4 },
  {
    id: 'picture-on-picture',
    name: 'Picture on Picture',
    icon: Layers,
    maxStreams: 10,
  },
  {
    id: 'softu-tv',
    name: 'Softu TV',
    icon: LayoutGrid,
    maxStreams: 4,
  },
] as const satisfies LayoutConfig[];

type LayoutSelectorProps = {
  changeLayout: (layout: Layout) => void;
  activeLayoutId: string;
  connectedStreamsLength: number;
};

export default function LayoutSelector({
  changeLayout,
  activeLayoutId,
  connectedStreamsLength,
}: LayoutSelectorProps) {
  const renderLayoutPreview = (layoutId: string) => {
    const config = LAYOUT_CONFIGS.find((l) => l.id === layoutId);
    if (!config) return null;

    const streamCount = Math.min(connectedStreamsLength, config.maxStreams);

    switch (layoutId) {
      case 'grid':
        return (
          <div className='w-full h-full grid grid-cols-2 gap-0.5'>
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className={`transition-all duration-300 ease-in-out rounded-none
                              ${i < streamCount ? 'bg-neutral-600 border border-neutral-700' : 'border border-dashed border-neutral-700'}`}
              />
            ))}
          </div>
        );
      case 'primary-on-left':
        return (
          <div className='w-full h-full flex gap-0.5'>
            <div
              className={`transition-all duration-300 ease-in-out w-2/3 rounded-none border border-neutral-700 ${streamCount > 0 ? 'bg-neutral-600' : 'bg-transparent'}`}
            />
            <div className='w-1/3 flex flex-col gap-0.5'>
              {Array.from({ length: 3 }).map((_, i) => {
                const isActive = i < streamCount - 1;
                return (
                  <div
                    key={i}
                    className={`transition-all duration-300 ease-in-out flex-1 rounded-none border ${isActive ? 'border-neutral-700 bg-neutral-600' : 'border-dashed border-neutral-700'}`}
                  />
                );
              })}
            </div>
          </div>
        );
      case 'primary-on-top':
        return (
          <div className='w-full h-full flex flex-col gap-0.5'>
            <div
              className={`transition-all duration-300 ease-in-out h-2/3 rounded-none border border-neutral-700 ${streamCount > 0 ? 'bg-neutral-600' : 'bg-transparent'}`}
            />
            <div className='h-1/3 flex gap-0.5'>
              {Array.from({ length: 3 }).map((_, i) => {
                const isActive = i < Math.max(0, streamCount - 1);
                return (
                  <div
                    key={i}
                    className={`transition-all duration-300 ease-in-out flex-1 rounded-none border ${isActive ? 'border-neutral-700 bg-neutral-600' : 'border-dashed border-neutral-700'}`}
                  />
                );
              })}
            </div>
          </div>
        );
      case 'picture-in-picture':
        return (
          <div className='w-full h-full relative'>
            <div
              className={`transition-all duration-300 ease-in-out w-full h-full rounded-none border border-neutral-700 ${streamCount > 0 ? 'bg-neutral-600' : 'bg-transparent'}`}
            />
            {Array.from({ length: Math.max(0, streamCount - 1) }).map(
              (_, idx) => {
                return (
                  <div
                    key={idx}
                    className='transition-all duration-300 ease-in-out absolute border border-neutral-700 bg-neutral-600 rounded-none'
                    style={{
                      top: `${0.5 + idx * 1.7}rem`,
                      right: '0.5rem',
                      width: '25%',
                      height: '25%',
                      zIndex: 10 + idx,
                    }}></div>
                );
              },
            )}
          </div>
        );
      case 'wrapped':
        return (
          <div className='w-full h-full relative'>
            <div
              className={`transition-all duration-300 ease-in-out w-full h-full rounded-none border border-neutral-700 ${streamCount > 0 ? 'bg-neutral-600' : 'bg-transparent'}`}
            />
            <div className='absolute inset-0 flex items-center justify-center gap-2'>
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={idx}
                  className={`transition-all duration-300 ease-in-out border border-neutral-700 rounded-none ${
                    streamCount > 0 ? 'bg-neutral-600' : 'bg-transparent'
                  }`}
                  style={{
                    width: '15%',
                    height: '15%',
                  }}></div>
              ))}
            </div>
          </div>
        );
      case 'wrapped-static':
        return (
          <div className='w-full h-full relative'>
            <div
              className={`transition-all duration-300 ease-in-out w-full h-full rounded-none border border-neutral-700 ${streamCount > 0 ? 'bg-neutral-600' : 'bg-transparent'}`}
            />
            <div className='absolute inset-0 flex items-center justify-center gap-2'>
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={idx}
                  className={`transition-all duration-300 ease-in-out border border-neutral-700 rounded-none ${
                    streamCount > 0 ? 'bg-neutral-600' : 'bg-transparent'
                  }`}
                  style={{
                    width: '15%',
                    height: '15%',
                  }}></div>
              ))}
            </div>
          </div>
        );
      case 'softu-tv':
        return (
          <div className='w-full h-full relative'>
            <div
              className={`transition-all duration-300 ease-in-out w-full h-full rounded-none border border-neutral-700 ${streamCount > 0 ? 'bg-neutral-600' : 'bg-transparent'}`}
            />
            {Array.from({ length: Math.max(0, streamCount - 1) }).map(
              (_, idx) => {
                return (
                  <div
                    key={idx}
                    className='transition-all duration-300 ease-in-out absolute border border-neutral-700 bg-neutral-600 rounded-none'
                    style={{
                      top: `${0.5 + idx * 1.7}rem`,
                      right: '0.5rem',
                      width: '25%',
                      height: '25%',
                      zIndex: 10 + idx,
                    }}></div>
                );
              },
            )}
          </div>
        );
      case 'picture-on-picture':
        return (
          <div className='w-full h-full relative'>
            {Array.from({ length: Math.min(streamCount, 4) }).map((_, idx) => (
              <div
                key={idx}
                className={`transition-all duration-300 ease-in-out absolute rounded-none border border-neutral-700 ${
                  streamCount > idx ? 'bg-neutral-600' : 'bg-transparent'
                }`}
                style={{
                  top: `${idx * 5}%`,
                  left: `${idx * 5}%`,
                  width: '100%',
                  height: '100%',
                  zIndex: idx,
                }}></div>
            ))}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <motion.div
      {...(fadeIn2 as any)}
      className='text-card-foreground flex-col gap-1 rounded-none py-6 shadow-sm flex flex-1 bg-[#0a0a0a]'>
      <div>
        <div className='grid grid-cols-2 gap-2'>
          {LAYOUT_CONFIGS.map((layout) => {
            const Icon = layout.icon;
            const isActive = activeLayoutId === layout.id;
            return (
              <button
                key={layout.id}
                onClick={() => changeLayout(layout.id)}
                className={`duration-300 ease-in-out p-2 rounded-none border transition-colors cursor-pointer ${isActive ? 'bg-neutral-800 border-white' : 'bg-[#141414] border-[#2a2a2a] hover:bg-neutral-800/50'}`}>
                <div className='aspect-video mb-1 text-xs'>
                  {renderLayoutPreview(layout.id)}
                </div>
                <div className='flex items-center justify-center gap-1'>
                  <Icon className='w-3 h-3 text-neutral-400' />
                  <span className='text-xs text-neutral-400'>
                    {layout.name}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
