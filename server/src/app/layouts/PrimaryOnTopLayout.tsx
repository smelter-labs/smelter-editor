import { View, Rescaler, Tiles, Shader } from '@swmansion/smelter';
import React, { useContext } from 'react';
import { useStore } from 'zustand';
import { StoreContext, useResolution, useIsVertical, useSwapDurationMs, useSwapOutgoingEnabled, useSwapFadeInDurationMs } from '../store';
import { Input, SmallInput } from '../../inputs/inputs';
import { usePrimarySwapTransition } from './usePrimarySwapTransition';
import { usePostSwapFadeIn } from './usePostSwapFadeIn';

const TILES_PADDING = 10;

export function PrimaryOnTopLayout() {
  const store = useContext(StoreContext);
  const inputs = useStore(store, state => state.inputs);
  const resolution = useResolution();
  const isVertical = useIsVertical();
  const swapDurationMs = useSwapDurationMs();
  const swapOutgoingEnabled = useSwapOutgoingEnabled();
  const swapFadeInDurationMs = useSwapFadeInDurationMs();
  const firstInput = inputs[0];
  const swap = usePrimarySwapTransition(inputs, swapDurationMs);
  const fadeOpacity = usePostSwapFadeIn(swap.isTransitioning, swapFadeInDurationMs);

  if (!firstInput) {
    return <View />;
  }

  const primaryHeight = Math.round(resolution.height * 0.55);
  const secondaryHeight = resolution.height - primaryHeight;

  const smallInputs = inputs.filter(input => input.inputId !== firstInput.inputId);

  const prevTileCount = Math.max(1, swap.prevSecondaryCount);
  const tileW = Math.round((resolution.width - TILES_PADDING * (prevTileCount + 1)) / prevTileCount);
  const tileH = secondaryHeight - TILES_PADDING * 2;
  const incomingStartTop = primaryHeight + TILES_PADDING;
  const incomingStartLeft = TILES_PADDING + swap.incomingPrevIndex * (tileW + TILES_PADDING);

  return (
    <View style={{ width: resolution.width, height: resolution.height, overflow: 'visible' }}>
      <View style={{ width: resolution.width, height: resolution.height, direction: 'column', top: 0, left: 0 }}>
        <View style={{ width: resolution.width, height: primaryHeight }}>
          <Rescaler style={{ height: primaryHeight }}>
            <Input input={firstInput} />
          </Rescaler>
          {swap.isTransitioning && swap.outgoingInput && (
            <Rescaler style={{
              top: 0,
              left: 0,
              width: swapOutgoingEnabled
                ? resolution.width - swap.progress * (resolution.width - tileW)
                : resolution.width,
              height: swapOutgoingEnabled
                ? primaryHeight - swap.progress * (primaryHeight - tileH)
                : primaryHeight,
            }}>
              <Input input={swap.outgoingInput} />
            </Rescaler>
          )}
        </View>
        <Shader
          shaderId="opacity"
          resolution={{ width: resolution.width, height: secondaryHeight }}
          shaderParam={{ type: 'struct', value: [{ type: 'f32', fieldName: 'opacity', value: fadeOpacity }] }}>
          <View style={{ width: resolution.width, height: secondaryHeight }}>
            <Tiles transition={{ durationMs: 300 }} style={{ padding: TILES_PADDING }}>
              {smallInputs.map(input => (
                <SmallInput key={input.inputId} input={input} />
              ))}
            </Tiles>
          </View>
        </Shader>
      </View>
      {swap.isTransitioning && swap.incomingInput && (
        <Rescaler style={{
          top: incomingStartTop + swap.progress * (0 - incomingStartTop),
          left: incomingStartLeft + swap.progress * (0 - incomingStartLeft),
          width: tileW + swap.progress * (resolution.width - tileW),
          height: tileH + swap.progress * (primaryHeight - tileH),
        }}>
          <Input input={swap.incomingInput} />
        </Rescaler>
      )}
    </View>
  );
}
