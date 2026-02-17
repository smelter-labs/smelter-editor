import { View, Rescaler, Tiles } from '@swmansion/smelter';
import React, { useContext } from 'react';
import { useStore } from 'zustand';
import { StoreContext, useResolution, useIsVertical, useSwapDurationMs } from '../store';
import { Input, SmallInput } from '../../inputs/inputs';
import { usePrimarySwapTransition } from './usePrimarySwapTransition';

const TILES_PADDING = 10;

export function PrimaryOnTopLayout() {
  const store = useContext(StoreContext);
  const inputs = useStore(store, state => state.inputs);
  const resolution = useResolution();
  const isVertical = useIsVertical();
  const swapDurationMs = useSwapDurationMs();
  const firstInput = inputs[0];
  const swap = usePrimarySwapTransition(inputs, swapDurationMs);

  if (!firstInput) {
    return <View />;
  }

  const primaryHeight = Math.round(resolution.height * 0.55);
  const secondaryHeight = resolution.height - primaryHeight;

  const smallInputs = inputs.filter(input => input.inputId !== firstInput.inputId);

  // Tiles are laid out horizontally (side by side) in the bottom strip
  const prevTileCount = Math.max(1, swap.prevSecondaryCount);
  const tileW = Math.round((resolution.width - TILES_PADDING * (prevTileCount + 1)) / prevTileCount);
  const tileH = secondaryHeight - TILES_PADDING * 2;
  const incomingStartTop = primaryHeight + TILES_PADDING;
  const incomingStartLeft = TILES_PADDING + swap.incomingPrevIndex * (tileW + TILES_PADDING);

  return (
    <View style={{ direction: 'column' }}>
      <View style={{ width: resolution.width, height: primaryHeight }}>
        <Rescaler style={{ height: primaryHeight }}>
          <Input input={firstInput} />
        </Rescaler>
        {swap.isTransitioning && swap.outgoingInput && (
          <Rescaler style={{
            top: 0,
            left: 0,
            width: resolution.width - swap.progress * (resolution.width - tileW),
            height: primaryHeight - swap.progress * (primaryHeight - tileH),
          }}>
            <Input input={swap.outgoingInput} />
          </Rescaler>
        )}
      </View>
      <Tiles transition={{ durationMs: 300 }} style={{ padding: TILES_PADDING }}>
        {smallInputs.map(input => (
          <SmallInput key={input.inputId} input={input} />
        ))}
      </Tiles>
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
