import { View, Rescaler, Tiles, Shader } from '@swmansion/smelter';
import React, { useContext } from 'react';
import { useStore } from 'zustand';
import { StoreContext, useResolution, useIsVertical, useSwapDurationMs, useSwapOutgoingEnabled, useSwapFadeInDurationMs } from '../store';
import { Input, SmallInput } from '../../inputs/inputs';
import { usePrimarySwapTransition } from './usePrimarySwapTransition';
import { usePostSwapFadeIn } from './usePostSwapFadeIn';

const TILES_PADDING = 10;

export function PrimaryOnLeftLayout() {
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

  const primaryWidth = isVertical 
    ? resolution.width 
    : Math.round(resolution.width * 0.6);
  const primaryHeight = isVertical 
    ? Math.round(resolution.height * 0.6) 
    : resolution.height;

  const secondaryWidth = isVertical ? resolution.width : resolution.width - primaryWidth;
  const secondaryHeight = isVertical ? resolution.height - primaryHeight : resolution.height;

  const smallInputs = inputs.filter(input => input.inputId !== firstInput.inputId);

  const prevTileCount = Math.max(1, swap.prevSecondaryCount);
  let incomingStartTop: number;
  let incomingStartLeft: number;
  let tileW: number;
  let tileH: number;

  if (isVertical) {
    tileW = Math.round((secondaryWidth - TILES_PADDING * (prevTileCount + 1)) / prevTileCount);
    tileH = secondaryHeight - TILES_PADDING * 2;
    incomingStartTop = primaryHeight + TILES_PADDING;
    incomingStartLeft = TILES_PADDING + swap.incomingPrevIndex * (tileW + TILES_PADDING);
  } else {
    tileW = secondaryWidth - TILES_PADDING * 2;
    tileH = Math.round((secondaryHeight - TILES_PADDING * (prevTileCount + 1)) / prevTileCount);
    incomingStartTop = TILES_PADDING + swap.incomingPrevIndex * (tileH + TILES_PADDING);
    incomingStartLeft = primaryWidth + TILES_PADDING;
  }

  return (
    <View style={{ width: resolution.width, height: resolution.height, overflow: 'visible' }}>
      <View style={{ width: resolution.width, height: resolution.height, direction: isVertical ? 'column' : 'row', top: 0, left: 0 }}>
        <View style={isVertical ? { width: resolution.width, height: primaryHeight } : { width: primaryWidth, height: resolution.height }}>
          <Rescaler style={isVertical ? { height: primaryHeight } : { width: primaryWidth }}>
            <Input input={firstInput} />
          </Rescaler>
          {swap.isTransitioning && swap.outgoingInput && (
            <Rescaler style={{
              top: 0,
              left: 0,
              width: swapOutgoingEnabled
                ? (isVertical
                    ? resolution.width - swap.progress * (resolution.width - tileW)
                    : primaryWidth - swap.progress * (primaryWidth - tileW))
                : (isVertical ? resolution.width : primaryWidth),
              height: swapOutgoingEnabled
                ? (isVertical
                    ? primaryHeight - swap.progress * (primaryHeight - tileH)
                    : resolution.height - swap.progress * (resolution.height - tileH))
                : (isVertical ? primaryHeight : resolution.height),
            }}>
              <Input input={swap.outgoingInput} />
            </Rescaler>
          )}
        </View>
        <Shader
          shaderId="opacity"
          resolution={{ width: secondaryWidth, height: secondaryHeight }}
          shaderParam={{ type: 'struct', value: [{ type: 'f32', fieldName: 'opacity', value: fadeOpacity }] }}>
          <View style={{ width: secondaryWidth, height: secondaryHeight }}>
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
          width: tileW + swap.progress * ((isVertical ? resolution.width : primaryWidth) - tileW),
          height: tileH + swap.progress * ((isVertical ? primaryHeight : resolution.height) - tileH),
        }}>
          <Input input={swap.incomingInput} />
        </Rescaler>
      )}
    </View>
  );
}
