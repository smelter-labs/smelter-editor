import { View, Tiles, Rescaler, Image, Text, Shader } from '@swmansion/smelter';
import React, { useContext, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { StoreContext, useResolution, useIsVertical, useSwapDurationMs, useSwapOutgoingEnabled, useSwapFadeInDurationMs, useSwapFadeOutDurationMs, useNewsStripFadeDuringSwap } from '../store';
import { Input, SmallInput } from '../../inputs/inputs';
import { NewsStripDecorated } from '../NewsStripDecorated';
import { usePrimarySwapTransition } from './usePrimarySwapTransition';
import { usePostSwapFadeIn } from './usePostSwapFadeIn';

export function PictureInPictureLayout() {
  const store = useContext(StoreContext);
  const inputs = useStore(store, state => state.inputs);
  const resolution = useResolution();
  const isVertical = useIsVertical();
  const swapDurationMs = useSwapDurationMs();
  const swapOutgoingEnabled = useSwapOutgoingEnabled();
  const swapFadeInDurationMs = useSwapFadeInDurationMs();
  const swapFadeOutDurationMs = useSwapFadeOutDurationMs();
  const newsStripFadeDuringSwap = useNewsStripFadeDuringSwap();
  const firstInput = inputs[0];
  const secondInput = inputs[1];
  const swap = usePrimarySwapTransition(inputs, swapDurationMs);
  const fadeOpacity = usePostSwapFadeIn(swap.isTransitioning, swapFadeInDurationMs, swapFadeOutDurationMs);

  const { width, height } = resolution;

  const [waveAmpPx, setWaveAmpPx] = useState(0);
  const [waveSpeed, setWaveSpeed] = useState(0);
  const [marqueeLeft, setMarqueeLeft] = useState(width);
  useEffect(() => {
    let mounted = true;
    let tweenId: ReturnType<typeof setInterval> | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let marqueeId: ReturnType<typeof setInterval> | null = null;
    const tween = (from: number, to: number, ms: number) => {
      if (tweenId) {
        clearInterval(tweenId);
        tweenId = null;
      }
      const start = Date.now();
      tweenId = setInterval(() => {
        const t = Math.min(1, (Date.now() - start) / Math.max(1, ms));
        const val = from + (to - from) * t;
        if (!mounted) {
          return;
        }
        setWaveAmpPx(Math.max(0, val));
        if (t >= 1) {
          if (tweenId) {
            clearInterval(tweenId);
            tweenId = null;
          }
        }
      }, 16);
    };
    const runCycle = () => {
      if (!mounted) {
        return;
      }
      setWaveSpeed(0);
      setWaveAmpPx(0);
      if (!marqueeId) {
        const pxPerSec = 240;
        const intervalMs = 10;
        const step = (pxPerSec * intervalMs) / 1000;
        const resetRight = width;
        const minLeft = -width * 2.2;
        marqueeId = setInterval(() => {
          if (!mounted) {
            return;
          }
          setMarqueeLeft(prev => {
            const next = prev - step;
            return next < minLeft ? resetRight : next;
          });
        }, intervalMs);
      }
      timerId = setTimeout(() => {
        if (!mounted) {
          return;
        }
        setWaveSpeed(6);
        tween(0, 25, 500);
        timerId = setTimeout(() => {
          if (!mounted) {
            return;
          }
          tween(25, 0, 500);
          timerId = setTimeout(() => {
            if (!mounted) {
              return;
            }
            runCycle();
          }, 4000);
        }, 2000);
      }, 3000);
    };
    runCycle();
    return () => {
      mounted = false;
      if (tweenId) {
        clearInterval(tweenId);
      }
      if (timerId) {
        clearTimeout(timerId);
      }
    };
  }, [width]);

  if (!firstInput) {
    return <View style={{ backgroundColor: '#000000', width, height }} />;
  }

  const pipWidth = isVertical ? Math.round(width * 0.8) : Math.round(width * 0.25);
  const pipHeight = isVertical ? Math.round(height * 0.35) : Math.round(height * 0.75);
  const pipTop = isVertical ? Math.round(height * 0.62) : 60;
  const pipRight = isVertical ? Math.round((width - pipWidth) / 2) : 60;
  const pipLeft = width - pipRight - pipWidth;

  const stripHeight = isVertical ? Math.round(height * 0.12) : Math.round(height * 0.31);
  const stripTop = isVertical ? height - stripHeight : Math.round(height * 0.67);
  const showStrip = !isVertical;

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
      {showStrip && newsStripFadeDuringSwap && <Rescaler
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
          shaderParam={{ type: 'struct', value: [{ type: 'f32', fieldName: 'opacity', value: fadeOpacity }] }}>
          <View style={{ width, height: stripHeight }}>
        <NewsStripDecorated
          resolution={{ width, height: stripHeight }}
          opacity={1}
          amplitudePx={waveAmpPx}
          wavelengthPx={800}
          speed={waveSpeed}
          phase={0}
          removeColorTolerance={0.4}>
          <View style={{ width, height: stripHeight, direction: 'column' }}>
            {/* left logo box */}
            <View
              style={{
                width: Math.round(width * 0.094),
                height: Math.round(stripHeight * 0.16),
                top: Math.round(stripHeight * 0.25),
                left: 0,
                direction: 'column',
                overflow: 'hidden',
                backgroundColor: '#F24664',
              }}>
              <Text
                style={{
                  fontSize: Math.round(stripHeight * 0.09),
                  lineHeight: Math.round(stripHeight * 0.16),
                  color: '#000000',
                  fontFamily: 'Poppins',
                  fontWeight: 'bold',
                  align: 'center',
                  width: Math.round(width * 0.094),
                  height: Math.round(stripHeight * 0.16),
                }}>
                LIVE
              </Text>
            </View>
            <View
              style={{
                width: Math.round(width * 0.094),
                height: Math.round(stripHeight * 0.43),
                top: Math.round(stripHeight * 0.41),
                left: 0,
                direction: 'column',
                overflow: 'hidden',
                backgroundColor: '#ffffff',
              }}>
              <Rescaler style={{ rescaleMode: 'fill', width: Math.round(width * 0.059), height: Math.round(stripHeight * 0.16), top: Math.round(stripHeight * 0.12), left: Math.round(width * 0.02) }}>
                <Image imageId="smelter_logo" />
              </Rescaler>
            </View>
            <View
              style={{
                width: Math.round(width * 0.906),
                height: Math.round(stripHeight * 0.43),
                top: Math.round(stripHeight * 0.41),
                left: Math.round(width * 0.094),
                direction: 'column',
                overflow: 'hidden',
                backgroundColor: '#342956',
              }}>
              <View
                style={{
                  direction: 'column',
                  height: Math.round(stripHeight * 0.43),
                  width: Math.round(width * 1.4),
                  overflow: 'visible',
                  padding: 10,
                  top: Math.round(stripHeight * 0.11),
                  left: Math.round(marqueeLeft),
                }}>
                <Text
                  style={{
                    fontSize: Math.round(stripHeight * 0.16),
                    width: Math.round(width * 2.7),
                    color: '#ffffff',
                    fontFamily: 'Poppins',
                    fontWeight: 'normal',
                  }}>
                  {'This video is composed of multiple videos and overlays in real time using smelter. Want to learn more? Reach out at contact@smelter.dev.'.toUpperCase()}
                </Text>
              </View>
            </View>
          </View>
        </NewsStripDecorated>
          </View>
        </Shader>
      </Rescaler>}
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
      {showStrip && !newsStripFadeDuringSwap && <Rescaler
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
          <View style={{ width, height: stripHeight }}>
        <NewsStripDecorated
          resolution={{ width, height: stripHeight }}
          opacity={1}
          amplitudePx={waveAmpPx}
          wavelengthPx={800}
          speed={waveSpeed}
          phase={0}
          removeColorTolerance={0.4}>
          <View style={{ width, height: stripHeight, direction: 'column' }}>
            {/* left logo box */}
            <View
              style={{
                width: Math.round(width * 0.094),
                height: Math.round(stripHeight * 0.16),
                top: Math.round(stripHeight * 0.25),
                left: 0,
                direction: 'column',
                overflow: 'hidden',
                backgroundColor: '#F24664',
              }}>
              <Text
                style={{
                  fontSize: Math.round(stripHeight * 0.09),
                  lineHeight: Math.round(stripHeight * 0.16),
                  color: '#000000',
                  fontFamily: 'Poppins',
                  fontWeight: 'bold',
                  align: 'center',
                  width: Math.round(width * 0.094),
                  height: Math.round(stripHeight * 0.16),
                }}>
                LIVE
              </Text>
            </View>
            <View
              style={{
                width: Math.round(width * 0.094),
                height: Math.round(stripHeight * 0.43),
                top: Math.round(stripHeight * 0.41),
                left: 0,
                direction: 'column',
                overflow: 'hidden',
                backgroundColor: '#ffffff',
              }}>
              <Rescaler style={{ rescaleMode: 'fill', width: Math.round(width * 0.059), height: Math.round(stripHeight * 0.16), top: Math.round(stripHeight * 0.12), left: Math.round(width * 0.02) }}>
                <Image imageId="smelter_logo" />
              </Rescaler>
            </View>
            <View
              style={{
                width: Math.round(width * 0.906),
                height: Math.round(stripHeight * 0.43),
                top: Math.round(stripHeight * 0.41),
                left: Math.round(width * 0.094),
                direction: 'column',
                overflow: 'hidden',
                backgroundColor: '#342956',
              }}>
              <View
                style={{
                  direction: 'column',
                  height: Math.round(stripHeight * 0.43),
                  width: Math.round(width * 1.4),
                  overflow: 'visible',
                  padding: 10,
                  top: Math.round(stripHeight * 0.11),
                  left: Math.round(marqueeLeft),
                }}>
                <Text
                  style={{
                    fontSize: Math.round(stripHeight * 0.16),
                    width: Math.round(width * 2.7),
                    color: '#ffffff',
                    fontFamily: 'Poppins',
                    fontWeight: 'normal',
                  }}>
                  {'This video is composed of multiple videos and overlays in real time using smelter. Want to learn more? Reach out at contact@smelter.dev.'.toUpperCase()}
                </Text>
              </View>
            </View>
          </View>
        </NewsStripDecorated>
          </View>
      </Rescaler>}
    </View>
  );
}
