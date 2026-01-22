import { useState, useRef, useEffect } from 'react';
import { Input } from '@/app/actions/actions';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';

function hasEnabledShader(input: Input) {
  if (!input.shaders) return false;
  return input.shaders.some((shader) => shader.enabled);
}

interface StatusButtonProps {
  input: Input;
  loading: boolean;
  showSliders: boolean;
  onClick: () => void;
}

export function StatusButton({
  input,
  loading,
  showSliders,
  onClick,
}: StatusButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [showOnlyIcon, setShowOnlyIcon] = useState(false);
  const shaderAnyEnabled = hasEnabledShader(input);
  const installedCount = (input.shaders || []).length;

  useEffect(() => {
    const checkWidth = () => {
      if (buttonRef.current) {
        const width = buttonRef.current.offsetWidth;
        setShowOnlyIcon(width < 120);
      }
    };

    checkWidth();
    window.addEventListener('resize', checkWidth);
    const resizeObserver = new ResizeObserver(checkWidth);
    if (buttonRef.current) {
      resizeObserver.observe(buttonRef.current);
    }

    return () => {
      window.removeEventListener('resize', checkWidth);
      resizeObserver.disconnect();
    };
  }, []);

  const getStatusLabel = () => {
    if (loading) {
      return <LoadingSpinner size='sm' variant='spinner' />;
    }
    const baseIcon = (
      <img
        src='/magic-wand.svg'
        width={16}
        height={16}
        alt=''
        className={showOnlyIcon ? 'opacity-90' : 'mr-2 opacity-90'}
      />
    );
    if (showOnlyIcon) {
      return baseIcon;
    }
    if (showSliders) {
      return (
        <span className='flex items-center'>
          {baseIcon}
          Hide FX
        </span>
      );
    }
    if (installedCount === 0) {
      return (
        <span className='flex items-center'>
          {baseIcon}
          Add Effects
        </span>
      );
    }
    if (shaderAnyEnabled) {
      return (
        <span className='flex items-center gap-2'>
          <span className='flex items-center'>
            {baseIcon}
            Effects
          </span>
          <span className='inline-flex items-center justify-center rounded-none bg-white text-black text-[10px] font-semibold w-5 h-5 leading-none'>
            {installedCount}
          </span>
        </span>
      );
    }
    return (
      <span className='flex items-center'>
        {baseIcon}
        Show FX
      </span>
    );
  };

  const getStatusColor = () => {
    if (showSliders) return 'bg-neutral-700 hover:bg-neutral-600';
    return 'bg-neutral-900 border-2 border-neutral-700 hover:bg-neutral-700';
  };

  return (
    <Button
      ref={buttonRef}
      data-no-dnd
      size='sm'
      style={{ width: '100%' }}
      className={`text-xs text-white hover:opacity-75 cursor-pointer overflow-hidden ${getStatusColor()} transition-all duration-200`}
      onClick={onClick}>
      {getStatusLabel()}
    </Button>
  );
}
