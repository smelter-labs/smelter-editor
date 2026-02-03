import { useEffect, useRef, useCallback } from 'react';
import type { Driver, DriveStep } from 'driver.js';

import '@/components/tour/driver.tour.css';

type DriverFn = typeof import('driver.js').driver;
type UseDriverTourOptions = Parameters<DriverFn>[0];

let driverModule: { driver: DriverFn } | null = null;
let cssLoaded = false;
const loadDriver = async () => {
  if (!cssLoaded && typeof document !== 'undefined') {
    // await import('driver.js/dist/driver.css');
    cssLoaded = true;
  }
  if (!driverModule) {
    driverModule = await import('driver.js');
  }
  return driverModule.driver;
};

export type DriverTourOptions = Omit<UseDriverTourOptions, 'steps'>;

export type DriverTourApi = {
  start: () => void;
  reset: () => void;
  stop: () => void;
  forceStop: () => void;
  highlight: (step: DriveStep) => void;
  next: () => void;
  prev: () => void;
  moveTo: (index: number) => void;
  nextIf: (expectedIndex: number) => void;
  prevIf: (expectedIndex: number) => void;
  instance: Driver | null;
};

export function useDriverTour(
  id: string,
  steps: DriveStep[],
  options: DriverTourOptions = {},
): DriverTourApi {
  const driverRef = useRef<Driver | null>(null);
  const forceDestroyRef = useRef<boolean>(false);
  const endConfirmOpenRef = useRef<boolean>(false);
  const overlayClickHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);

  const showEndTourConfirm = useCallback((): Promise<boolean> => {
    if (endConfirmOpenRef.current) {
      // If it's already open, return a promise that resolves false to avoid double-destroy
      return Promise.resolve(false);
    }
    endConfirmOpenRef.current = true;
    return new Promise<boolean>((resolve) => {
      try {
        document.body.classList.add('smelter-modal-open');
        const overlay = document.createElement('div');
        overlay.className =
          'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center';
        overlay.style.zIndex = '2147483647';
        overlay.style.pointerEvents = 'auto';
        const modal = document.createElement('div');
        modal.className =
          'bg-[#141414] border border-neutral-700 p-6 max-w-md mx-4';
        const title = document.createElement('h3');
        title.className = 'text-white text-lg font-semibold mb-4';
        title.textContent = 'End Tour?';
        const desc = document.createElement('p');
        desc.className = 'text-neutral-400 mb-6';
        desc.textContent =
          'You are about to end the tour. Would you like to continue the tour or end it now?';
        const buttons = document.createElement('div');
        buttons.className = 'flex gap-3 justify-end';
        const cancelBtn = document.createElement('button');
        cancelBtn.className =
          'px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white font-medium cursor-pointer';
        cancelBtn.textContent = 'Keep Touring';
        const confirmBtn = document.createElement('button');
        confirmBtn.className =
          'px-4 py-2 bg-white hover:bg-neutral-200 text-black font-medium cursor-pointer';
        confirmBtn.textContent = 'End Tour';
        buttons.appendChild(cancelBtn);
        buttons.appendChild(confirmBtn);
        modal.appendChild(title);
        modal.appendChild(desc);
        modal.appendChild(buttons);
        overlay.appendChild(modal);
        const cleanup = () => {
          try {
            overlay.remove();
          } catch {}
          document.body.classList.remove('smelter-modal-open');
          endConfirmOpenRef.current = false;
        };
        cancelBtn.addEventListener('click', () => {
          resolve(false);
          cleanup();
        });
        confirmBtn.addEventListener('click', () => {
          resolve(true);
          cleanup();
        });

        document.body.appendChild(overlay);
      } catch {
        endConfirmOpenRef.current = false;
        resolve(false);
      }
    });
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (driverRef.current?.isActive?.()) {
        driverRef.current?.refresh?.();
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const attachOverlayClickGuard = useCallback(() => {
    try {
      const overlay = document.querySelector(
        '.driver-overlay',
      ) as HTMLElement | null;
      if (!overlay) return;
      if (overlayClickHandlerRef.current) {
        overlay.removeEventListener(
          'click',
          overlayClickHandlerRef.current,
          true,
        );
      }
      const handler = (e: MouseEvent) => {
        try {
          const activeIndex = driverRef.current?.getActiveIndex?.();
          // room tour, step index 2: [data-tour="twitch-suggestion-item-container"]
          if (id === 'room' && activeIndex === 2) {
            e.preventDefault();
            e.stopPropagation();
            (e as any).stopImmediatePropagation?.();
            driverRef.current?.movePrevious?.();
          }
        } catch {}
      };
      overlay.addEventListener('click', handler, true);
      overlayClickHandlerRef.current = handler;
    } catch {}
  }, [id]);

  const detachOverlayClickGuard = useCallback(() => {
    try {
      const overlay = document.querySelector(
        '.driver-overlay',
      ) as HTMLElement | null;
      if (overlay && overlayClickHandlerRef.current) {
        overlay.removeEventListener(
          'click',
          overlayClickHandlerRef.current,
          true,
        );
      }
    } catch {}
    overlayClickHandlerRef.current = null;
  }, []);

  const start = useCallback(() => {
    let resizeObserver: ResizeObserver | null = null;
    let observedElement: Element | null = null;
    let rafId: number | null = null;

    const scheduleRefresh = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        driverRef.current?.refresh?.();
      });
    };

    const attachResizeObserver = (element?: Element) => {
      if (!element) return;
      if (typeof window === 'undefined' || !('ResizeObserver' in window))
        return;
      if (resizeObserver && observedElement === element) return;
      if (resizeObserver && observedElement && observedElement !== element) {
        resizeObserver.unobserve(observedElement);
      }
      if (!resizeObserver) {
        resizeObserver = new ResizeObserver(() => {
          if (driverRef.current?.isActive?.()) {
            scheduleRefresh();
          }
        });
      }
      observedElement = element;
      resizeObserver.observe(element);
    };

    const detachResizeObserver = () => {
      if (resizeObserver && observedElement) {
        resizeObserver.unobserve(observedElement);
      }
      observedElement = null;
    };

    const userOnHighlighted = (options as UseDriverTourOptions)?.onHighlighted;
    const userOnDeselected = (options as UseDriverTourOptions)?.onDeselected;
    const userOnPopoverRender = (options as UseDriverTourOptions)
      ?.onPopoverRender;

    const config: UseDriverTourOptions = {
      showProgress: true,
      ...options,
      overlayOpacity: 0.6,
      popoverClass: 'driverjs-theme',
      steps,
      onHighlighted: (element, step, ctx) => {
        attachResizeObserver(element);
        userOnHighlighted?.(element, step, ctx);
        attachOverlayClickGuard();
      },
      onDeselected: (element, step, ctx) => {
        detachResizeObserver();
        userOnDeselected?.(element, step, ctx);
        detachOverlayClickGuard();
      },
      onDestroyStarted: () => {
        detachOverlayClickGuard();
        if (forceDestroyRef.current) {
          driverRef.current?.destroy();
          try {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('smelter:tour:stop', { detail: { id } }),
              );
            }
          } catch {}
          return;
        }
        const currentIndex =
          (driverRef.current?.getActiveIndex?.() as number | undefined) ?? 0;
        const hasMore = !!driverRef.current?.hasNextStep?.();
        // If no more steps, end without asking
        if (!hasMore) {
          driverRef.current?.destroy?.();
          try {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('smelter:tour:stop', { detail: { id } }),
              );
            }
          } catch {}
          return;
        }
        forceDestroyRef.current = true;
        try {
          driverRef.current?.destroy?.();
        } finally {
          forceDestroyRef.current = false;
        }
        void showEndTourConfirm().then((shouldEnd) => {
          if (shouldEnd) {
            try {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('smelter:tour:stop', { detail: { id } }),
                );
              }
            } catch {}
            return;
          }
          try {
            (async () => {
              start();
              requestAnimationFrame(() => {
                try {
                  if (id === 'room' && currentIndex === 2) {
                    driverRef.current?.moveTo?.(1);
                  } else {
                    driverRef.current?.moveTo?.(currentIndex);
                  }
                } catch {}
              });
            })();
          } catch {}
        });
      },
      onPopoverRender: (popover: any, ctx: any) => {
        userOnPopoverRender?.(popover, ctx);
        const { wrapper, footer, progress } = popover;
        if (!wrapper || !footer || !progress) return;
        const totalSteps = steps.length;
        const activeIndex = (ctx?.state?.activeIndex ??
          ctx?.state?.currentStep ??
          0) as number;
        const currentStep = Math.min(Math.max(activeIndex + 1, 1), totalSteps);
        const percent = totalSteps > 1 ? (currentStep / totalSteps) * 100 : 100;
        // Insert or update "Step X of Y" label above title
        try {
          const titleEl = wrapper.querySelector(
            '.driver-popover-title',
          ) as HTMLDivElement | null;
          if (titleEl) {
            let stepLabel =
              titleEl.previousElementSibling as HTMLDivElement | null;
            if (
              !stepLabel ||
              !stepLabel.classList.contains('driverjs-step-label')
            ) {
              stepLabel = document.createElement('div');
              stepLabel.className = 'driverjs-step-label';
              titleEl.parentElement?.insertBefore(stepLabel, titleEl);
            }
            stepLabel.textContent = `Step ${currentStep} of ${totalSteps}`;
          }
        } catch {}
        // Render steps as dots instead of a linear progress bar
        let dotsContainer = wrapper.querySelector(
          '.driverjs-steps-dots',
        ) as HTMLDivElement | null;
        if (!dotsContainer) {
          dotsContainer = document.createElement('div');
          dotsContainer.className = 'driverjs-steps-dots';
          for (let i = 0; i < totalSteps; i++) {
            const dot = document.createElement('span');
            dot.className = 'driverjs-step-dot';
            dotsContainer.appendChild(dot);
          }
          wrapper.insertBefore(dotsContainer, footer);
        }
        // Sync active dot
        const dots = Array.from(
          dotsContainer.querySelectorAll('.driverjs-step-dot'),
        ) as HTMLSpanElement[];
        // If steps count changed, re-create
        if (dots.length !== totalSteps) {
          dotsContainer.innerHTML = '';
          for (let i = 0; i < totalSteps; i++) {
            const dot = document.createElement('span');
            dot.className = 'driverjs-step-dot';
            dotsContainer.appendChild(dot);
          }
        }
        const allDots = Array.from(
          dotsContainer.querySelectorAll('.driverjs-step-dot'),
        ) as HTMLSpanElement[];
        allDots.forEach((d, idx) => {
          if (idx === currentStep - 1) {
            d.classList.add('active');
          } else {
            d.classList.remove('active');
          }
        });

        // Remove prev button from DOM entirely if it's hidden to avoid layout offset
        try {
          const prevBtn = wrapper.querySelector(
            '.driver-popover-prev-btn',
          ) as HTMLButtonElement | null;
          if (prevBtn) {
            const inline = prevBtn.getAttribute('style') || '';
            const computed =
              typeof window !== 'undefined'
                ? window.getComputedStyle(prevBtn)
                : (null as any);
            if (
              inline.includes('display: none') ||
              computed?.display === 'none'
            ) {
              const parent = prevBtn.parentElement;
              prevBtn.remove();
              // Normalize nav container alignment after removal
              if (
                parent &&
                parent.classList.contains('driver-popover-navigation-btns')
              ) {
                try {
                  (parent as HTMLElement).style.justifyContent = 'flex-start';
                } catch {}
              }
            }
          }
        } catch {}
      },
    };

    try {
      driverRef.current?.destroy?.();
    } catch {}

    loadDriver().then((driver) => {
      const d = driver(config);
      driverRef.current = d;
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('smelter:tour:start', { detail: { id } }),
          );
        }
      } catch {}
      d.drive();
    });
  }, [id, options, steps]);

  const reset = useCallback(() => {
    driverRef.current?.refresh?.();
  }, []);

  const stop = useCallback(() => {
    driverRef.current?.destroy?.();
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('smelter:tour:stop', { detail: { id } }),
        );
      }
    } catch {}
  }, []);

  const forceStop = useCallback(() => {
    forceDestroyRef.current = true;
    try {
      driverRef.current?.destroy?.();
    } finally {
      forceDestroyRef.current = false;
    }
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('smelter:tour:stop', { detail: { id } }),
        );
      }
    } catch {}
  }, []);

  const highlight = useCallback((step: DriveStep) => {
    driverRef.current?.highlight?.(step);
  }, []);

  const next = useCallback(() => {
    driverRef.current?.moveNext?.();
  }, []);

  const prev = useCallback(() => {
    driverRef.current?.movePrevious?.();
  }, []);

  const moveTo = useCallback((index: number) => {
    driverRef.current?.moveTo?.(index);
  }, []);

  const nextIf = useCallback((expectedIndex: number) => {
    const currentIndex = driverRef.current?.getActiveIndex?.();
    if (currentIndex === expectedIndex) {
      driverRef.current?.moveNext?.();
    }
  }, []);

  const prevIf = useCallback((expectedIndex: number) => {
    const currentIndex = driverRef.current?.getActiveIndex?.();
    if (currentIndex === expectedIndex) {
      driverRef.current?.movePrevious?.();
    }
  }, []);

  return {
    start,
    reset,
    stop,
    forceStop,
    highlight,
    next,
    prev,
    moveTo,
    nextIf,
    prevIf,
    instance: driverRef.current,
  };
}
