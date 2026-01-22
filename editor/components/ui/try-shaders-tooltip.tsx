'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface Position {
  top: number;
  left: number;
  arrowTop?: number;
  arrowLeft?: number;
  arrowCentered?: boolean;
}

export default function TryShadersTooltip() {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<Element | null>(null);
  const cancelTimeoutRef = useRef<number | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const showTimeoutRef = useRef<number | null>(null);
  const teardownPositioningRef = useRef<(() => void) | null>(null);

  // Hide tooltip on mouse out
  const startHideTimeoutRef = useRef<number | null>(null);

  // Handle mouse enter/leave for tooltip and target
  const handleMouseEnter = useCallback(() => {
    if (startHideTimeoutRef.current) {
      window.clearTimeout(startHideTimeoutRef.current);
      startHideTimeoutRef.current = null;
    }
  }, []);
  const handleMouseLeave = useCallback(() => {
    if (startHideTimeoutRef.current) return;
    startHideTimeoutRef.current = window.setTimeout(() => {
      setVisible(false);
    }, 100); // slight delay to avoid flicker
  }, []);

  // Attach mouse events to tooltip and target, clean up on unmount or hide
  useEffect(() => {
    if (!visible) return;
    const tip = tooltipRef.current;
    const target = targetRef.current;

    if (tip) {
      tip.addEventListener('mouseenter', handleMouseEnter);
      tip.addEventListener('mouseleave', handleMouseLeave);
    }
    if (target) {
      target.addEventListener('mouseenter', handleMouseEnter);
      target.addEventListener('mouseleave', handleMouseLeave);
    }

    return () => {
      if (tip) {
        tip.removeEventListener('mouseenter', handleMouseEnter);
        tip.removeEventListener('mouseleave', handleMouseLeave);
      }
      if (target) {
        target.removeEventListener('mouseenter', handleMouseEnter);
        target.removeEventListener('mouseleave', handleMouseLeave);
      }
      if (startHideTimeoutRef.current) {
        window.clearTimeout(startHideTimeoutRef.current);
        startHideTimeoutRef.current = null;
      }
    };
  }, [visible, handleMouseEnter, handleMouseLeave]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let revealed = false;

    const findTarget = () => {
      const el = document.querySelector('.show-shaders-button');
      if (el) {
        targetRef.current = el;
        if (!revealed) {
          // Show tooltip after delay when target is present
          if (!showTimeoutRef.current) {
            showTimeoutRef.current = window.setTimeout(() => {
              if (teardownPositioningRef.current)
                teardownPositioningRef.current();
              teardownPositioningRef.current = setupPositioning();
              setVisible(true);
            }, 2000);
          }
          revealed = true;
        } else {
          // (shouldn't happen, but) reveal immediately if already delayed
          if (teardownPositioningRef.current) teardownPositioningRef.current();
          teardownPositioningRef.current = setupPositioning();
          setVisible(true);
        }
        return true;
      }
      // If target is removed before the delay, cancel the tooltip display
      if (showTimeoutRef.current) {
        window.clearTimeout(showTimeoutRef.current);
        showTimeoutRef.current = null;
      }
      return false;
    };

    const setupObserver = () => {
      if (observerRef.current) return;
      observerRef.current = new MutationObserver(() => {
        findTarget();
      });
      observerRef.current.observe(document.body, {
        childList: true,
        subtree: true,
      });
    };

    // Stop trying after a while to avoid unnecessary work
    const scheduleCancel = () => {
      if (cancelTimeoutRef.current) return;
      cancelTimeoutRef.current = window.setTimeout(() => {
        observerRef.current?.disconnect();
        observerRef.current = null;
        cancelTimeoutRef.current = null;

        if (showTimeoutRef.current) {
          window.clearTimeout(showTimeoutRef.current);
          showTimeoutRef.current = null;
        }
      }, 2500);
    };

    const setupPositioning = () => {
      const update = () => {
        const target = targetRef.current as HTMLElement | null;
        const tip = tooltipRef.current;
        if (!target) return;
        const rect = target.getBoundingClientRect();

        // Default place tooltip to the right of the button
        let top = Math.max(8, rect.top + rect.height / 2);
        let left = rect.right + 12;

        let arrowLeft = 0;

        // If tooltip has size, adjust to center vertically
        if (tip) {
          const tipRect = tip.getBoundingClientRect();
          top = Math.max(8, rect.top + rect.height / 2 - tipRect.height / 2);

          // Arrow placement on right
          arrowLeft = tipRect.width - 6;

          // Ensure it doesn't overflow right edge
          const overflowRight = left + tipRect.width - window.innerWidth + 8;
          if (overflowRight > 0) {
            left = Math.max(8, rect.left - 12 - tipRect.width);
            // Arrow placement on left if flipping, but per instructions, keep on right
            arrowLeft = tipRect.width - 6;
          }
        }

        // Always center the arrow vertically using CSS
        setPosition({
          top,
          left,
          arrowLeft,
          arrowCentered: true,
        });
      };

      update();
      window.addEventListener('resize', update);
      window.addEventListener('scroll', update, true);

      const id = window.setInterval(update, 250);

      return () => {
        window.removeEventListener('resize', update);
        window.removeEventListener('scroll', update, true);
        window.clearInterval(id);
      };
    };

    const cleanup = () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (cancelTimeoutRef.current) {
        window.clearTimeout(cancelTimeoutRef.current);
        cancelTimeoutRef.current = null;
      }
      if (showTimeoutRef.current) {
        window.clearTimeout(showTimeoutRef.current);
        showTimeoutRef.current = null;
      }
      if (teardownPositioningRef.current) {
        teardownPositioningRef.current();
        teardownPositioningRef.current = null;
      }
    };

    if (!findTarget()) {
      setupObserver();
      scheduleCancel();
    }

    return () => {
      cleanup();
    };
    // eslint-disable-next-line
    }, []);

  // Dismiss when clicking outside or pressing Escape
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setVisible(false);
    };
    const onClick = (e: MouseEvent) => {
      const tip = tooltipRef.current;
      if (tip && e.target instanceof Node && !tip.contains(e.target)) {
        setVisible(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick, true);
    };
  }, [visible]);

  if (!visible || !position) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={tooltipRef}
      style={{
        top: position.top,
        left: position.left,
        position: 'fixed',
        zIndex: 9999,
      }}
      className='bg-neutral-900 text-white rounded-none border border-neutral-700 px-4 py-3 max-w-xs'
      // Attach for redundancy (in case portal mount delays effect)
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}>
      <div className='text-normal font-semibold'>Try out shaders</div>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '50%',
          left: position.arrowLeft ?? '100%',
          transform: 'translateY(-50%) rotate(45deg)',
          width: 12,
          height: 12,
          background: '#171717',
        }}
      />
    </div>,
    document.body,
  );
}
