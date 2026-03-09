import { View, Tiles, Rescaler, Shader } from '@swmansion/smelter';
import React, { useContext } from 'react';
import { useStore } from 'zustand';
import { StoreContext, useResolution, useIsVertical, useSwapDurationMs, useSwapOutgoingEnabled, useSwapFadeInDurationMs, useSwapFadeOutDurationMs } from '../store';
import { Input, SmallInput } from '../../inputs/inputs';
import { usePrimarySwapTransition } from '../transitions/usePrimarySwapTransition';
import { usePostSwapFadeIn } from '../transitions/usePostSwapFadeIn';

export function SoftuTvLayout() {
  const store = useContext(StoreContext);
  const inputs = useStore(store, state => state.inputs);
  const resolution = useResolution();
  const isVertical = useIsVertical();
  const swapDurationMs = useSwapDurationMs();
  const swapOutgoingEnabled = useSwapOutgoingEnabled();
  const swapFadeInDurationMs = useSwapFadeInDurationMs();
  const swapFadeOutDurationMs = useSwapFadeOutDurationMs();
  const firstInput = inputs[0];
  const secondInput = inputs[1];
  const swap = usePrimarySwapTransition(inputs, swapDurationMs);
  const fadeOpacity = usePostSwapFadeIn(swap.isTransitioning, swapFadeInDurationMs, swapFadeOutDurationMs);

  const { width, height } = resolution;

  if (!firstInput) {
    return <View style={{ backgroundColor: '#000000', width, height }} />;
  }

  const pipWidth = isVertical ? Math.round(width * 0.8) : Math.round(width * 0.25);
  const pipHeight = isVertical ? Math.round(height * 0.35) : Math.round(height * 0.75);
  const pipTop = isVertical ? Math.round(height * 0.62) : 60;
  const pipRight = isVertical ? Math.round((width - pipWidth) / 2) : 60;
  const pipLeft = width - pipRight - pipWidth;

  // Tile positions within the PIP area
  // Tiles component applies `padding` around each tile (2*padding between adjacent tiles)
  const tilePadding = 10;
  const prevTileCount = Math.max(1, swap.prevSecondaryCount);
  const tileW = pipWidth - tilePadding * 2;
  const tileH = Math.round(pipHeight / prevTileCount - tilePadding * 2);
  const tileAbsTop = pipTop + tilePadding + swap.incomingPrevIndex * (tileH + tilePadding * 2);
  const tileAbsLeft = pipLeft + tilePadding;

  return (
    <View style={{ width, height, overflow: 'visible' }}>
      <View style={{ direction: 'column', width, height, top: 0, left: 0 }}>
      <Rescaler
        transition={{ durationMs: 300 }}
        style={{
          rescaleMode: 'fill',
          horizontalAlign: isVertical ? 'center' : 'left',
          verticalAlign: 'top',
          width,
          height,
          top: 0,
          left: 0,
        }}>
        <Input input={firstInput} />
      </Rescaler>
      {swap.isTransitioning && swap.outgoingInput && (
        <Rescaler style={{
          rescaleMode: 'fill',
          horizontalAlign: isVertical ? 'center' : 'left',
          verticalAlign: 'top',
          top: 0,
          left: 0,
          width: swapOutgoingEnabled ? width - swap.progress * (width - tileW) : width,
          height: swapOutgoingEnabled ? height - swap.progress * (height - tileH) : height,
        }}>
          <Input input={swap.outgoingInput} />
        </Rescaler>
      )}
      {secondInput ? (
        <Rescaler style={{ top: pipTop, right: pipRight, width: pipWidth, height: pipHeight }}>
          <Shader
            shaderId="opacity"
            resolution={{ width: pipWidth, height: pipHeight }}
            shaderParam={{ type: 'struct', value: [{ type: 'f32', fieldName: 'opacity', value: fadeOpacity }] }}>
            <View style={{ width: pipWidth, height: pipHeight, direction: 'column' }}>
              <Tiles transition={{ durationMs: swapFadeOutDurationMs > 0 ? swapFadeOutDurationMs : 300 }} style={{ padding: tilePadding, verticalAlign: 'top' }}>
                {Object.values(inputs)
                  .filter(input => input.inputId != firstInput.inputId)
                  .map(input => (
                    <SmallInput key={input.inputId} input={input} />
                  ))}
              </Tiles>
            </View>
          </Shader>
        </Rescaler>
      ) : null}
      </View>
      {swap.isTransitioning && swap.incomingInput && (
        <Rescaler style={{
          top: tileAbsTop + swap.progress * (0 - tileAbsTop),
          left: tileAbsLeft + swap.progress * (0 - tileAbsLeft),
          width: tileW + swap.progress * (width - tileW),
          height: tileH + swap.progress * (height - tileH),
        }}>
          <Input input={swap.incomingInput} />
        </Rescaler>
      )}
    </View>
  );
}
