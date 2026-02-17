import { View, Rescaler, Tiles } from '@swmansion/smelter';
import React, { useContext } from 'react';
import { useStore } from 'zustand';
import { StoreContext, useResolution, useIsVertical, useSwapDurationMs } from '../store';
import { Input, SmallInput } from '../../inputs/inputs';
import { usePrimarySwapTransition } from './usePrimarySwapTransition';

const TILES_PADDING = 10;

export function PrimaryOnLeftLayout() {
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

  const primaryWidth = isVertical 
    ? resolution.width 
    : Math.round(resolution.width * 0.6);
  const primaryHeight = isVertical 
    ? Math.round(resolution.height * 0.6) 
    : resolution.height;

  const secondaryWidth = isVertical ? resolution.width : resolution.width - primaryWidth;
  const secondaryHeight = isVertical ? resolution.height - primaryHeight : resolution.height;

  const smallInputs = inputs.filter(input => input.inputId !== firstInput.inputId);

  // Approximate tile positions (tiles stack vertically in horizontal mode, horizontally in vertical mode)
  // Tiles uses padding around and between tiles
  const prevTileCount = Math.max(1, swap.prevSecondaryCount);
  let incomingStartTop: number;
  let incomingStartLeft: number;
  let tileW: number;
  let tileH: number;

  if (isVertical) {
    // Tiles laid out horizontally
    tileW = Math.round((secondaryWidth - TILES_PADDING * (prevTileCount + 1)) / prevTileCount);
    tileH = secondaryHeight - TILES_PADDING * 2;
    incomingStartTop = primaryHeight + TILES_PADDING;
    incomingStartLeft = TILES_PADDING + swap.incomingPrevIndex * (tileW + TILES_PADDING);
  } else {
    // Tiles laid out vertically
    tileW = secondaryWidth - TILES_PADDING * 2;
    tileH = Math.round((secondaryHeight - TILES_PADDING * (prevTileCount + 1)) / prevTileCount);
    incomingStartTop = TILES_PADDING + swap.incomingPrevIndex * (tileH + TILES_PADDING);
    incomingStartLeft = primaryWidth + TILES_PADDING;
  }

  return (
    <View style={{ direction: isVertical ? 'column' : 'row' }}>
      <View style={isVertical ? { width: resolution.width, height: primaryHeight } : { width: primaryWidth, height: resolution.height }}>
        <Rescaler style={isVertical ? { height: primaryHeight } : { width: primaryWidth }}>
          <Input input={firstInput} />
        </Rescaler>
        {swap.isTransitioning && swap.outgoingInput && (
          <Rescaler style={{
            top: 0,
            left: 0,
            width: isVertical
              ? resolution.width - swap.progress * (resolution.width - tileW)
              : primaryWidth - swap.progress * (primaryWidth - tileW),
            height: isVertical
              ? primaryHeight - swap.progress * (primaryHeight - tileH)
              : resolution.height - swap.progress * (resolution.height - tileH),
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
          width: tileW + swap.progress * ((isVertical ? resolution.width : primaryWidth) - tileW),
          height: tileH + swap.progress * ((isVertical ? primaryHeight : resolution.height) - tileH),
        }}>
          <Input input={swap.incomingInput} />
        </Rescaler>
      )}
    </View>
  );
}
