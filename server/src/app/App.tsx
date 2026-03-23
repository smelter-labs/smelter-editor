import { View, Rescaler } from '@swmansion/smelter';

import type { RoomStore } from './store';
import type { StoreApi } from 'zustand';
import { StoreContext, useResolution, useInputs, useLayers } from './store';
import { NewsStripOverlay } from './news-strip';
import { Input } from '../inputs/inputs';

function buildEasingFunction(easing?: string) {
  if (easing === 'bounce') return 'bounce' as const;
  if (easing === 'cubic_bezier_ease_in_out') {
    return {
      functionName: 'cubic_bezier' as const,
      points: [0.65, 0, 0.35, 1] as [number, number, number, number],
    };
  }
  return 'linear' as const;
}

export default function App({ store }: { store: StoreApi<RoomStore> }) {
  return (
    <StoreContext.Provider value={store}>
      <OutputScene />
    </StoreContext.Provider>
  );
}

function OutputScene() {
  const resolution = useResolution();
  const inputs = useInputs();
  const layers = useLayers();
  const { width, height } = resolution;

  const inputMap = new Map(inputs.map((input) => [input.inputId, input]));

  return (
    <View
      style={{
        backgroundColor: '#000000',
        padding: 0,
        width,
        height,
        overflow: 'visible',
      }}>
      {layers.map((layer) => (
        <View
          key={layer.id}
          style={{ top: 0, left: 0, width, height, overflow: 'visible' }}>
          {layer.inputs.map((item) => {
            const input = inputMap.get(item.inputId);
            if (!input) return null;
            return (
              <Rescaler
                key={item.inputId}
                id={`layer-${layer.id}-${item.inputId}`}
                transition={{
                  durationMs: item.transitionDurationMs ?? 300,
                  easingFunction: buildEasingFunction(item.transitionEasing),
                }}
                style={{
                  top: item.y,
                  left: item.x,
                  width: item.width,
                  height: item.height,
                }}>
                <Input input={input} />
              </Rescaler>
            );
          })}
        </View>
      ))}
      <NewsStripOverlay />
    </View>
  );
}
