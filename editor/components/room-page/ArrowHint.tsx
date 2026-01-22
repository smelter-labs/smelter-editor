'use client';

import { useEffect, useRef, useState } from 'react';

type ArrowHintProps = {
  targetRef: React.RefObject<Element | null>;
  initiallyVisible?: boolean;
  autoHideMs?: number;
};

export default function ArrowHint({
  targetRef,
  initiallyVisible = true,
  autoHideMs = 25000,
}: ArrowHintProps) {
  const [visible, setVisible] = useState(initiallyVisible);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInteractedRef = useRef(false);
  const [arrowLeft, setArrowLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) return;

    function handleAnyInteraction() {
      if (!hasInteractedRef.current) {
        hasInteractedRef.current = true;
        setVisible(false);
        window.removeEventListener('pointerdown', handleAnyInteraction, true);
        window.removeEventListener('keydown', handleAnyInteraction, true);
      }
    }

    window.addEventListener('pointerdown', handleAnyInteraction, true);
    window.addEventListener('keydown', handleAnyInteraction, true);

    timeoutIdRef.current = setTimeout(() => {
      setVisible(false);
    }, autoHideMs);

    return () => {
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      window.removeEventListener('pointerdown', handleAnyInteraction, true);
      window.removeEventListener('keydown', handleAnyInteraction, true);
    };
  }, [visible, autoHideMs]);

  useEffect(() => {
    if (!visible) return;
    const buttonEl = targetRef.current as HTMLElement | null;
    if (buttonEl) {
      const btnRect = buttonEl.getBoundingClientRect();
      const parentRect =
        buttonEl.parentElement?.parentElement?.getBoundingClientRect();
      if (parentRect) {
        const centerOffset =
          btnRect.left - parentRect.left + btnRect.width / 2 - 13;
        setArrowLeft(centerOffset);
      }
    }
  }, [visible, targetRef]);

  if (!visible) return null;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: arrowLeft !== null ? `${arrowLeft}px` : '86px',
          top: '50%',
          transform: 'translateY(24px)',
          width: '26px',
          height: '26px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pointerEvents: 'none',
          zIndex: 20,
          transition: 'left 0.18s cubic-bezier(.41,1.8,.5,.89)',
        }}>
        <svg
          width='26'
          height='26'
          viewBox='0 0 26 26'
          fill='white'
          xmlns='http://www.w3.org/2000/svg'
          className='animate-bounceArrowDown'
          style={{
            filter: 'drop-shadow(0 1px 8px rgba(0,0,0,0.25))',
          }}>
          <g>
            <polygon
              points='13,21 5,11 9.5,11 9.5,5 16.5,5 16.5,11 21,11'
              fill='white'
              stroke='#fff'
              strokeWidth='1'
              style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.18))' }}
              transform='rotate(180 13 13)'
            />
          </g>
        </svg>
      </div>
      <style jsx>{`
        @keyframes bounceArrowDown {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(10px);
          }
        }
        .animate-bounceArrowDown {
          animation: bounceArrowDown 0.7s cubic-bezier(0.41, 1.8, 0.5, 0.89)
            infinite;
        }
      `}</style>
    </>
  );
}
