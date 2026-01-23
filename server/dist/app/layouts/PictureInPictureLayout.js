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
function PictureInPictureLayout() {
    const store = (0, react_1.useContext)(store_1.StoreContext);
    const inputs = (0, zustand_1.useStore)(store, state => state.inputs);
    const firstInput = inputs[0];
    const secondInput = inputs[1];
    const [waveAmpPx, setWaveAmpPx] = (0, react_1.useState)(0);
    const [waveSpeed, setWaveSpeed] = (0, react_1.useState)(0);
    const [marqueeLeft, setMarqueeLeft] = (0, react_1.useState)(2560);
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
                const resetRight = 2560;
                const minLeft = -5620;
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
    }, []);
    if (!firstInput) {
        return (0, jsx_runtime_1.jsx)(smelter_1.View, { style: { backgroundColor: '#000000', width: 2560, height: 1440 } });
    }
    return ((0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { direction: 'column' }, children: [(0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { transition: { durationMs: 300 }, style: {
                    rescaleMode: 'fill',
                    horizontalAlign: 'left',
                    verticalAlign: 'top',
                    width: 2560,
                    height: 1440,
                    top: 0,
                    left: 0,
                }, children: (0, jsx_runtime_1.jsx)(inputs_1.Input, { input: firstInput }) }), secondInput ? ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { top: 60, right: 60, width: 640, height: 1080 }, children: (0, jsx_runtime_1.jsx)(smelter_1.View, { style: { direction: 'column' }, children: (0, jsx_runtime_1.jsx)(smelter_1.Tiles, { transition: { durationMs: 300 }, style: { padding: 10, verticalAlign: 'top' }, children: Object.values(inputs)
                            .filter(input => input.inputId != firstInput.inputId)
                            .map(input => ((0, jsx_runtime_1.jsx)(inputs_1.SmallInput, { input: input }, input.inputId))) }) }) })) : null, (0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { transition: { durationMs: 300 }, style: {
                    rescaleMode: 'fill',
                    horizontalAlign: 'left',
                    verticalAlign: 'top',
                    width: 2560,
                    height: 450,
                    top: 960,
                    left: 0,
                }, children: (0, jsx_runtime_1.jsx)(NewsStripDecorated_1.NewsStripDecorated, { resolution: { width: 2560, height: 450 }, opacity: 1, amplitudePx: waveAmpPx, wavelengthPx: 800, speed: waveSpeed, phase: 0, removeColorTolerance: 0.4, children: (0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { width: 2560, height: 450, direction: 'column' }, children: [(0, jsx_runtime_1.jsx)(smelter_1.View, { style: {
                                    width: 240,
                                    height: 72,
                                    top: 114,
                                    left: 0,
                                    direction: 'column',
                                    overflow: 'hidden',
                                    backgroundColor: '#F24664',
                                }, children: (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: {
                                        fontSize: 40,
                                        lineHeight: 72,
                                        color: '#000000',
                                        fontFamily: 'Poppins',
                                        fontWeight: 'bold',
                                        align: 'center',
                                        width: 240,
                                        height: 72,
                                    }, children: "LIVE" }) }), (0, jsx_runtime_1.jsx)(smelter_1.View, { style: {
                                    width: 240,
                                    height: 192,
                                    top: Math.round((450 - 80) / 2),
                                    left: 0,
                                    direction: 'column',
                                    overflow: 'hidden',
                                    backgroundColor: '#ffffff',
                                }, children: (0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fill', width: 150, height: 72, top: 56, left: 50 }, children: (0, jsx_runtime_1.jsx)(smelter_1.Image, { imageId: "smelter_logo" }) }) }), (0, jsx_runtime_1.jsx)(smelter_1.View, { style: {
                                    width: 2320,
                                    height: 192,
                                    top: Math.round((450 - 80) / 2),
                                    left: 240,
                                    direction: 'column',
                                    overflow: 'hidden',
                                    backgroundColor: '#342956',
                                }, children: (0, jsx_runtime_1.jsx)(smelter_1.View, { style: {
                                        direction: 'column',
                                        height: 192,
                                        width: 3560,
                                        overflow: 'visible',
                                        padding: 10,
                                        top: 48,
                                        left: Math.round(marqueeLeft),
                                    }, children: (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: {
                                            fontSize: 72,
                                            width: 6860,
                                            color: '#ffffff',
                                            fontFamily: 'Poppins',
                                            fontWeight: 'normal',
                                        }, children: 'This video is composed of multiple videos and overlays in real time using smelter. Want to learn more? Reach out at contact@smelter.dev.'.toUpperCase() }) }) })] }) }) })] }));
}
