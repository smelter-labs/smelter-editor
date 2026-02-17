"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PictureInPictureLayout = PictureInPictureLayout;
const jsx_runtime_1 = require("react/jsx-runtime");
const smelter_1 = require("@swmansion/smelter");
const react_1 = require("react");
const zustand_1 = require("zustand");
const store_1 = require("../store");
const inputs_1 = require("../../inputs/inputs");
const NewsStripDecorated_1 = require("../NewsStripDecorated");
const usePrimarySwapTransition_1 = require("./usePrimarySwapTransition");
const usePostSwapFadeIn_1 = require("./usePostSwapFadeIn");
function PictureInPictureLayout() {
    const store = (0, react_1.useContext)(store_1.StoreContext);
    const inputs = (0, zustand_1.useStore)(store, state => state.inputs);
    const resolution = (0, store_1.useResolution)();
    const isVertical = (0, store_1.useIsVertical)();
    const swapDurationMs = (0, store_1.useSwapDurationMs)();
    const swapOutgoingEnabled = (0, store_1.useSwapOutgoingEnabled)();
    const swapFadeInDurationMs = (0, store_1.useSwapFadeInDurationMs)();
    const swapFadeOutDurationMs = (0, store_1.useSwapFadeOutDurationMs)();
    const newsStripFadeDuringSwap = (0, store_1.useNewsStripFadeDuringSwap)();
    const firstInput = inputs[0];
    const secondInput = inputs[1];
    const swap = (0, usePrimarySwapTransition_1.usePrimarySwapTransition)(inputs, swapDurationMs);
    const fadeOpacity = (0, usePostSwapFadeIn_1.usePostSwapFadeIn)(swap.isTransitioning, swapFadeInDurationMs, swapFadeOutDurationMs);
    const { width, height } = resolution;
    const [waveAmpPx, setWaveAmpPx] = (0, react_1.useState)(0);
    const [waveSpeed, setWaveSpeed] = (0, react_1.useState)(0);
    const [marqueeLeft, setMarqueeLeft] = (0, react_1.useState)(width);
    (0, react_1.useEffect)(() => {
        let mounted = true;
        let tweenId = null;
        let timerId = null;
        let marqueeId = null;
        const tween = (from, to, ms) => {
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
        return (0, jsx_runtime_1.jsx)(smelter_1.View, { style: { backgroundColor: '#000000', width, height } });
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
    return ((0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { width, height, overflow: 'visible' }, children: [(0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { direction: 'column', width, height, top: 0, left: 0 }, children: [(0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { transition: { durationMs: 300 }, style: {
                            rescaleMode: 'fill',
                            horizontalAlign: isVertical ? 'center' : 'left',
                            verticalAlign: 'top',
                            width,
                            height,
                            top: 0,
                            left: 0,
                        }, children: (0, jsx_runtime_1.jsx)(inputs_1.Input, { input: firstInput }) }), swap.isTransitioning && swap.outgoingInput && ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: {
                            rescaleMode: 'fill',
                            horizontalAlign: isVertical ? 'center' : 'left',
                            verticalAlign: 'top',
                            top: 0,
                            left: 0,
                            width: swapOutgoingEnabled ? width - swap.progress * (width - tileW) : width,
                            height: swapOutgoingEnabled ? height - swap.progress * (height - tileH) : height,
                        }, children: (0, jsx_runtime_1.jsx)(inputs_1.Input, { input: swap.outgoingInput }) })), secondInput ? ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { top: pipTop, right: pipRight, width: pipWidth, height: pipHeight }, children: (0, jsx_runtime_1.jsx)(smelter_1.Shader, { shaderId: "opacity", resolution: { width: pipWidth, height: pipHeight }, shaderParam: { type: 'struct', value: [{ type: 'f32', fieldName: 'opacity', value: fadeOpacity }] }, children: (0, jsx_runtime_1.jsx)(smelter_1.View, { style: { width: pipWidth, height: pipHeight, direction: 'column' }, children: (0, jsx_runtime_1.jsx)(smelter_1.Tiles, { transition: { durationMs: swapFadeOutDurationMs > 0 ? swapFadeOutDurationMs : 300 }, style: { padding: tilePadding, verticalAlign: 'top' }, children: Object.values(inputs)
                                        .filter(input => input.inputId != firstInput.inputId)
                                        .map(input => ((0, jsx_runtime_1.jsx)(inputs_1.SmallInput, { input: input }, input.inputId))) }) }) }) })) : null, showStrip && (0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { transition: { durationMs: 300 }, style: {
                            rescaleMode: 'fill',
                            horizontalAlign: 'left',
                            verticalAlign: 'top',
                            width,
                            height: stripHeight,
                            top: stripTop,
                            left: 0,
                        }, children: (0, jsx_runtime_1.jsx)(smelter_1.Shader, { shaderId: "opacity", resolution: { width, height: stripHeight }, shaderParam: { type: 'struct', value: [{ type: 'f32', fieldName: 'opacity', value: newsStripFadeDuringSwap ? fadeOpacity : 1 }] }, children: (0, jsx_runtime_1.jsx)(smelter_1.View, { style: { width, height: stripHeight }, children: (0, jsx_runtime_1.jsx)(NewsStripDecorated_1.NewsStripDecorated, { resolution: { width, height: stripHeight }, opacity: 1, amplitudePx: waveAmpPx, wavelengthPx: 800, speed: waveSpeed, phase: 0, removeColorTolerance: 0.4, children: (0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { width, height: stripHeight, direction: 'column' }, children: [(0, jsx_runtime_1.jsx)(smelter_1.View, { style: {
                                                    width: Math.round(width * 0.094),
                                                    height: Math.round(stripHeight * 0.16),
                                                    top: Math.round(stripHeight * 0.25),
                                                    left: 0,
                                                    direction: 'column',
                                                    overflow: 'hidden',
                                                    backgroundColor: '#F24664',
                                                }, children: (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: {
                                                        fontSize: Math.round(stripHeight * 0.09),
                                                        lineHeight: Math.round(stripHeight * 0.16),
                                                        color: '#000000',
                                                        fontFamily: 'Poppins',
                                                        fontWeight: 'bold',
                                                        align: 'center',
                                                        width: Math.round(width * 0.094),
                                                        height: Math.round(stripHeight * 0.16),
                                                    }, children: "LIVE" }) }), (0, jsx_runtime_1.jsx)(smelter_1.View, { style: {
                                                    width: Math.round(width * 0.094),
                                                    height: Math.round(stripHeight * 0.43),
                                                    top: Math.round(stripHeight * 0.41),
                                                    left: 0,
                                                    direction: 'column',
                                                    overflow: 'hidden',
                                                    backgroundColor: '#ffffff',
                                                }, children: (0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fill', width: Math.round(width * 0.059), height: Math.round(stripHeight * 0.16), top: Math.round(stripHeight * 0.12), left: Math.round(width * 0.02) }, children: (0, jsx_runtime_1.jsx)(smelter_1.Image, { imageId: "smelter_logo" }) }) }), (0, jsx_runtime_1.jsx)(smelter_1.View, { style: {
                                                    width: Math.round(width * 0.906),
                                                    height: Math.round(stripHeight * 0.43),
                                                    top: Math.round(stripHeight * 0.41),
                                                    left: Math.round(width * 0.094),
                                                    direction: 'column',
                                                    overflow: 'hidden',
                                                    backgroundColor: '#342956',
                                                }, children: (0, jsx_runtime_1.jsx)(smelter_1.View, { style: {
                                                        direction: 'column',
                                                        height: Math.round(stripHeight * 0.43),
                                                        width: Math.round(width * 1.4),
                                                        overflow: 'visible',
                                                        padding: 10,
                                                        top: Math.round(stripHeight * 0.11),
                                                        left: Math.round(marqueeLeft),
                                                    }, children: (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: {
                                                            fontSize: Math.round(stripHeight * 0.16),
                                                            width: Math.round(width * 2.7),
                                                            color: '#ffffff',
                                                            fontFamily: 'Poppins',
                                                            fontWeight: 'normal',
                                                        }, children: 'This video is composed of multiple videos and overlays in real time using smelter. Want to learn more? Reach out at contact@smelter.dev.'.toUpperCase() }) }) })] }) }) }) }) })] }), swap.isTransitioning && swap.incomingInput && ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: {
                    top: tileAbsTop + swap.progress * (0 - tileAbsTop),
                    left: tileAbsLeft + swap.progress * (0 - tileAbsLeft),
                    width: tileW + swap.progress * (width - tileW),
                    height: tileH + swap.progress * (height - tileH),
                }, children: (0, jsx_runtime_1.jsx)(inputs_1.Input, { input: swap.incomingInput }) }))] }));
}
