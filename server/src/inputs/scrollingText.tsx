import { Text, View } from '@swmansion/smelter';
import React, { useEffect, useMemo, useRef, useState } from 'react';

type ScrollingTextProps = {
  text: string;
  maxLines: number;
  scrollSpeed: number;
  scrollLoop: boolean;
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  containerWidth: number;
  containerHeight: number;
  scrollNudge?: number;
  /** Insert a blank line every N lines (0 = disabled) */
  linePaddingInterval?: number;
};

export function ScrollingText({
  text,
  maxLines,
  scrollSpeed,
  scrollLoop,
  fontSize,
  color,
  align,
  containerWidth,
  containerHeight,
  scrollNudge = 0,
  linePaddingInterval = 0,
}: ScrollingTextProps) {
  const lineHeight = fontSize * 1.2;
  const textVerticalPadding = Math.max(2, Math.round(fontSize * 0.12));
  const visibleHeight = containerHeight;
  const { paddedText, lines } = useMemo(() => {
    const rawLines = text.split('\n');
    if (linePaddingInterval <= 0) {
      return { paddedText: text, lines: rawLines };
    }
    const padded: string[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      padded.push(rawLines[i]);
      if ((i + 1) % linePaddingInterval === 0 && i < rawLines.length - 1) {
        padded.push('');
      }
    }
    return { paddedText: padded.join('\n'), lines: padded };
  }, [text, linePaddingInterval]);
  const measuredTextHeight = Math.max(lineHeight, lines.length * lineHeight);
  const totalTextHeight = measuredTextHeight + textVerticalPadding * 2;
  
  const shouldAnimate = maxLines > 0;
  const startPosition = visibleHeight - textVerticalPadding;
  
  const [scrollOffset, setScrollOffset] = useState(startPosition);
  const [permanentNudgeOffset, setPermanentNudgeOffset] = useState(0);
  const permanentNudgeRef = useRef(0);
  const [animatingNudge, setAnimatingNudge] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nudgeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevLinesCountRef = useRef(0);
  const initializedRef = useRef(false);
  const prevNudgeRef = useRef(0);

  useEffect(() => {
    if (scrollNudge !== 0 && scrollNudge !== prevNudgeRef.current) {
      prevNudgeRef.current = scrollNudge;
      const nudgeAmount = Math.floor(scrollNudge) * lineHeight;
      const nudgeDuration = 500;
      const intervalMs = 16;
      const steps = nudgeDuration / intervalMs;
      let currentStep = 0;

      if (nudgeTimerRef.current) {
        clearInterval(nudgeTimerRef.current);
      }

      nudgeTimerRef.current = setInterval(() => {
        currentStep++;
        const progress = currentStep / steps;
        const eased = progress < 0.5 
          ? 4 * progress * progress * progress 
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        
        setAnimatingNudge(nudgeAmount * eased);

        if (currentStep >= steps) {
          if (nudgeTimerRef.current) {
            clearInterval(nudgeTimerRef.current);
            nudgeTimerRef.current = null;
          }
          permanentNudgeRef.current += nudgeAmount;
          setPermanentNudgeOffset(permanentNudgeRef.current);
          setAnimatingNudge(0);
        }
      }, intervalMs);
    }
  }, [scrollNudge, lineHeight]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!shouldAnimate) {
      setScrollOffset(0);
      return;
    }

    const currentLinesCount = lines.length;
    const prevLinesCount = prevLinesCountRef.current;
    const isFirstRun = !initializedRef.current;
    
    prevLinesCountRef.current = currentLinesCount;
    initializedRef.current = true;

    if (isFirstRun) {
      setScrollOffset(startPosition);
    }

    const targetPosition = -(totalTextHeight - textVerticalPadding);
    const intervalMs = 16;
    const pixelsPerFrame = (scrollSpeed / 1000) * intervalMs;

    timerRef.current = setInterval(() => {
      setScrollOffset(prev => {
        const effectivePosition = prev + permanentNudgeRef.current;
        if (effectivePosition <= targetPosition) {
          if (scrollLoop) {
            permanentNudgeRef.current = 0;
            setPermanentNudgeOffset(0);
            return startPosition;
          }
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return targetPosition - permanentNudgeRef.current;
        }
        return prev - pixelsPerFrame;
      });
    }, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [text, shouldAnimate, totalTextHeight, startPosition, scrollSpeed, scrollLoop, lines.length]);

  const textTopOffset = shouldAnimate ? scrollOffset + permanentNudgeOffset + animatingNudge : 0;

  return (
    <View style={{ 
      width: containerWidth, 
      height: visibleHeight, 
      overflow: 'hidden',
    }}>
      <View style={{ 
        width: containerWidth,
        height: totalTextHeight,
        top: textTopOffset,
        left: 0,
      }}>
        <View
          style={{
            width: containerWidth,
            height: measuredTextHeight,
            top: textVerticalPadding,
            left: 0,
          }}>
          <Text style={{ 
            fontSize, 
            lineHeight,
            width: containerWidth,
            color, 
            wrap: 'word',
            align,
            fontFamily: 'Star Jedi',
          }}>
            {paddedText}
          </Text>
        </View>
      </View>
    </View>
  );
}
