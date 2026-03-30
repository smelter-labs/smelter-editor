# Patterns & Best Practices

Real-world patterns for building Smelter applications, derived from production projects.

## Table of Contents

- [Shader Wrapping / Chaining](#shader-wrapping--chaining)
- [Input State Rendering](#input-state-rendering)
- [Animations via Timers](#animations-via-timers)
- [Shader Color Parameters](#shader-color-parameters)
- [Multi-Output with Shared Store](#multi-output-with-shared-store)
- [Scrolling Text](#scrolling-text)

---

## Shader Wrapping / Chaining

Apply multiple shaders by recursively nesting `<Shader>` components. Each shader wraps the output of the previous one.

```tsx
function wrapWithShaders(
  component: ReactElement,
  shaders: ShaderConfig[],
  resolution: { width: number; height: number },
  index?: number,
): ReactElement {
  const currentIndex = index ?? shaders.length - 1;
  if (currentIndex < 0 || shaders.length === 0) {
    return component;
  }
  const shader = shaders[currentIndex];

  return (
    <Shader
      shaderId={shader.shaderId}
      resolution={resolution}
      shaderParam={buildShaderParams(shader)}>
      {wrapWithShaders(component, shaders, resolution, currentIndex - 1)}
    </Shader>
  );
}

// Usage: wrap an input with all its active shaders
const rendered = wrapWithShaders(
  <InputStream inputId="cam1" />,
  activeShaders,
  { width: 1920, height: 1080 }
);
```

**Key points:**
- Shaders nest inside-out: last shader in the array is the outermost wrapper
- Each `<Shader>` needs an explicit `resolution`
- Filter for enabled shaders before wrapping

---

## Input State Rendering

Use `useInputStreams()` to conditionally render based on input state (loading spinner, offline text, or live content).

```tsx
function Input({ inputId }: { inputId: string }) {
  const streams = useInputStreams();
  const streamState = streams[inputId]?.videoState ?? 'finished';

  return (
    <Rescaler style={{ width: 1920, height: 1080 }}>
      {streamState === 'playing' ? (
        <InputStream inputId={inputId} />
      ) : streamState === 'ready' ? (
        <View style={{ padding: 300 }}>
          <Rescaler style={{ rescaleMode: 'fit' }}>
            <Image imageId="spinner" />
          </Rescaler>
        </View>
      ) : (
        <View style={{ padding: 300 }}>
          <Text style={{ fontSize: 48 }}>Stream offline</Text>
        </View>
      )}
    </Rescaler>
  );
}
```

**Key points:**
- `videoState` transitions: `undefined` → `"ready"` → `"playing"` → `"finished"`
- For non-stream inputs (images, text, game), skip the stream check and treat as `"playing"`
- Always wrap in `<Rescaler>` for consistent sizing

---

## Animations via Timers

Smelter has no built-in animation system beyond `transition` on layout changes. For continuous animations (marquee, fade, swap transitions), use `setInterval` + React state.

```tsx
function useSwapAnimation(durationMs: number): { progress: number; isAnimating: boolean } {
  const [progress, setProgress] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const startAnimation = useCallback(() => {
    setIsAnimating(true);
    const startTime = Date.now();

    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(1, elapsed / durationMs);
      // Cubic ease-in-out
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      if (t >= 1) {
        clearInterval(timer);
        setProgress(1);
        setIsAnimating(false);
      } else {
        setProgress(eased);
      }
    }, 16); // ~60fps
  }, [durationMs]);

  return { progress, isAnimating };
}
```

**Key points:**
- Use 16ms interval (~60fps) for smooth animation
- Apply easing functions (cubic ease-in-out is common)
- Always cleanup intervals in useEffect return or when animation completes
- Use `useRef` to track previous state and detect changes (e.g., primary input swap)

---

## Shader Color Parameters

WGSL shaders expect color as separate `f32` fields (`_r`, `_g`, `_b`), not a single hex string. Convert hex → RGB floats when building shader params.

```tsx
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean;
  return {
    r: parseInt(full.substring(0, 2), 16) / 255,
    g: parseInt(full.substring(2, 4), 16) / 255,
    b: parseInt(full.substring(4, 6), 16) / 255,
  };
}

// Building shader params with a color field:
const rgb = hexToRgb('#ff4400');
const shaderParam = {
  type: 'struct' as const,
  value: [
    { type: 'f32' as const, fieldName: 'effect_color_r', value: rgb.r },
    { type: 'f32' as const, fieldName: 'effect_color_g', value: rgb.g },
    { type: 'f32' as const, fieldName: 'effect_color_b', value: rgb.b },
    { type: 'f32' as const, fieldName: 'intensity', value: 0.7 },
  ],
};
```

**Key points:**
- WGSL has no string type — colors must be split into per-channel `f32` values (0.0–1.0)
- Convention: name fields `<param>_r`, `<param>_g`, `<param>_b`
- The `ShaderParamStructField` uses `fieldName` (camelCase), NOT `field_name`

---

## Multi-Output with Shared Store

Use the same Zustand store for multiple outputs (e.g., live WHEP stream + MP4 recording) so they render identically.

```tsx
// Register live output
const store = createRoomStore();
await smelter.registerOutput("room_live", <App store={store} />, {
  type: "whep_server",
  video: { encoder: { type: "ffmpeg_h264" }, resolution: { width: 1920, height: 1080 } },
  audio: { encoder: { type: "opus" } },
});

// Register recording output — reuses the same store
await smelter.registerOutput("room_recording", <App store={store} />, {
  type: "mp4",
  serverPath: "./recording.mp4",
  video: { encoder: { type: "ffmpeg_h264", preset: "fast" }, resolution: { width: 1920, height: 1080 } },
  audio: { encoder: { type: "aac", channels: "stereo" } },
});
```

**Key points:**
- Both outputs share the same React tree and store — any state change affects both
- Use appropriate encoders per output type: `opus` for WebRTC, `aac` for MP4/RTMP
- Unregister the recording output independently when done

---

## Scrolling Text

Smelter has no built-in scrolling. Implement marquee/ticker by animating a `<View>` position with `setInterval`.

```tsx
function ScrollingText({ text, speed, containerWidth, containerHeight, fontSize }: Props) {
  const lineHeight = fontSize * 1.2;
  const [scrollOffset, setScrollOffset] = useState(containerHeight);

  useEffect(() => {
    const timer = setInterval(() => {
      setScrollOffset(prev => {
        const next = prev - speed * (16 / 1000);
        // Reset when text scrolls fully past
        if (next < -totalTextHeight) return containerHeight;
        return next;
      });
    }, 16);
    return () => clearInterval(timer);
  }, [speed, containerHeight]);

  return (
    <View style={{ width: containerWidth, height: containerHeight, overflow: 'hidden' }}>
      <View style={{ width: containerWidth, top: scrollOffset, left: 0 }}>
        <Text style={{ fontSize, lineHeight, width: containerWidth, wrap: 'word' }}>
          {text}
        </Text>
      </View>
    </View>
  );
}
```

**Key points:**
- Outer `<View>` with `overflow: 'hidden'` acts as the viewport
- Inner `<View>` is absolutely positioned (via `top`) and animated
- Speed is in pixels-per-second; convert in the interval: `speed * (intervalMs / 1000)`
- For horizontal marquee, animate `left` instead of `top`
