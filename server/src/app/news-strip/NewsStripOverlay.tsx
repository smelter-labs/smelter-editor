import { Rescaler, Shader } from '@swmansion/smelter';
import { View } from '@swmansion/smelter';
import React, { useContext } from 'react';
import { useStore } from 'zustand';
import { StoreContext, useResolution, useIsVertical, useNewsStripFadeDuringSwap, useNewsStripEnabled, useSwapDurationMs, useSwapFadeInDurationMs, useSwapFadeOutDurationMs } from '../store';
import { usePrimarySwapTransition } from '../transitions/usePrimarySwapTransition';
import { usePostSwapFadeIn } from '../transitions/usePostSwapFadeIn';
import { NewsStripDecorated } from './NewsStripDecorated';
import { NewsStripContent } from './NewsStripContent';
import type { NewsStripTheme } from './NewsStripContent';
import { useNewsStripAnimation } from './useNewsStripAnimation';

type NewsStripOverlayProps = {
  theme?: NewsStripTheme;
};

export function NewsStripOverlay({ theme }: NewsStripOverlayProps) {
  const store = useContext(StoreContext);
  const inputs = useStore(store, state => state.inputs);
  const resolution = useResolution();
  const isVertical = useIsVertical();
  const newsStripFadeDuringSwap = useNewsStripFadeDuringSwap();
  const newsStripEnabled = useNewsStripEnabled();
  const swapDurationMs = useSwapDurationMs();
  const swapFadeInDurationMs = useSwapFadeInDurationMs();
  const swapFadeOutDurationMs = useSwapFadeOutDurationMs();
  const swap = usePrimarySwapTransition(inputs, swapDurationMs);
  const fadeOpacity = usePostSwapFadeIn(swap.isTransitioning, swapFadeInDurationMs, swapFadeOutDurationMs);
  const { width, height } = resolution;
  const { waveAmpPx, waveSpeed, marqueeLeft } = useNewsStripAnimation(width);

  const stripHeight = isVertical ? Math.round(height * 0.12) : Math.round(height * 0.31);
  const stripTop = isVertical ? height - stripHeight : Math.round(height * 0.67);
  const showStrip = !isVertical && newsStripEnabled;

  if (!showStrip) {
    return null;
  }

  const opacityValue = newsStripFadeDuringSwap ? fadeOpacity : 1;

  return (
    <Rescaler
      transition={{ durationMs: 300 }}
      style={{
        rescaleMode: 'fill',
        horizontalAlign: 'left',
        verticalAlign: 'top',
        width,
        height: stripHeight,
        top: stripTop,
        left: 0,
      }}>
      <Shader
        shaderId="opacity"
        resolution={{ width, height: stripHeight }}
        shaderParam={{ type: 'struct', value: [{ type: 'f32', fieldName: 'opacity', value: opacityValue }] }}>
        <View style={{ width, height: stripHeight }}>
          <NewsStripDecorated
            resolution={{ width, height: stripHeight }}
            opacity={1}
            amplitudePx={waveAmpPx}
            wavelengthPx={800}
            speed={waveSpeed}
            phase={0}
            removeColorTolerance={0.4}>
            <NewsStripContent
              width={width}
              stripHeight={stripHeight}
              marqueeLeft={marqueeLeft}
              theme={theme}
            />
          </NewsStripDecorated>
        </View>
      </Shader>
    </Rescaler>
  );
}
