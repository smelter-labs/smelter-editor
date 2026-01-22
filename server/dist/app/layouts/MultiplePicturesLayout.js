"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WrappedLayout = WrappedLayout;
const jsx_runtime_1 = require("react/jsx-runtime");
const smelter_1 = require("@swmansion/smelter");
const react_1 = require("react");
const zustand_1 = require("zustand");
const store_1 = require("../store");
const inputs_1 = require("../../inputs/inputs");
// ----- Pure helpers (logic separated from React) -----
const EASING_DURATION_MS = 1200;
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function computeDesiredIds(inputs) {
    return inputs.map(i => i.inputId);
}
function buildYOffsetMap(ids, baseYOffset, stepYOffset) {
    const out = {};
    for (let idx = 0; idx < ids.length; idx++) {
        out[ids[idx]] = baseYOffset - idx * stepYOffset;
    }
    return out;
}
function xPatternOffset(index, stepPx) {
    if (index === 0) {
        return 0;
    }
    const magnitude = Math.ceil(index / 2) * stepPx;
    const sign = index % 2 === 1 ? -1 : 1; // 1:-x, 2:+x, 3:-2x, 4:+2x, ...
    return sign * magnitude;
}
function buildXOffsetMap(ids, xStepPx) {
    const out = {};
    for (let idx = 0; idx < ids.length; idx++) {
        out[ids[idx]] = xPatternOffset(idx, xStepPx);
    }
    return out;
}
function buildScaleMap(ids, baseScale, shrinkPercent) {
    const out = {};
    const factor = Math.max(0, 1 - shrinkPercent);
    for (let idx = 0; idx < ids.length; idx++) {
        out[ids[idx]] = baseScale * Math.pow(factor, idx);
    }
    return out;
}
function rand01(id, salt) {
    let h = 2166136261 >>> 0;
    const s = `${id}:${salt}`;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const x = Math.sin(h) * 43758.5453;
    return x - Math.floor(x);
}
function buildWobbleMaps(ids, baseWobbleXAmp, baseWobbleYAmp, baseWobbleXFreq, baseWobbleYFreq) {
    const wobbleXAmp = {};
    const wobbleYAmp = {};
    const wobbleXFreq = {};
    const wobbleYFreq = {};
    for (const id of ids) {
        const rAmpX = rand01(id, 101);
        const rAmpY = rand01(id, 202);
        const rFreqX = rand01(id, 303);
        const rFreqY = rand01(id, 404);
        const ampFactorX = 0.8 + 0.4 * rAmpX; // 0.8..1.2
        const ampFactorY = 0.8 + 0.4 * rAmpY; // 0.8..1.2
        const freqFactorX = 0.7 + 0.6 * rFreqX; // 0.7..1.3
        const freqFactorY = 0.7 + 0.6 * rFreqY; // 0.7..1.3
        wobbleXAmp[id] = baseWobbleXAmp * ampFactorX;
        wobbleYAmp[id] = baseWobbleYAmp * ampFactorY;
        wobbleXFreq[id] = Math.max(0.05, baseWobbleXFreq * freqFactorX);
        wobbleYFreq[id] = Math.max(0.05, baseWobbleYFreq * freqFactorY);
    }
    return { wobbleXAmp, wobbleYAmp, wobbleXFreq, wobbleYFreq };
}
function wrapHue(hue) {
    while (hue > 1) {
        hue -= 1;
    }
    return hue;
}
function WrappedLayout() {
    const store = (0, react_1.useContext)(store_1.StoreContext);
    const inputs = (0, zustand_1.useStore)(store, state => state.inputs);
    if (!inputs.length) {
        return (0, jsx_runtime_1.jsx)(smelter_1.View, {});
    }
    // Compute desired ids based only on inputs to avoid unstable deps
    const desiredIds = (0, react_1.useMemo)(() => computeDesiredIds(inputs), [inputs]);
    const inputById = (0, react_1.useMemo)(() => {
        const map = {};
        for (const i of inputs) {
            map[i.inputId] = i;
        }
        return map;
    }, [inputs]);
    // Global (non-animated) shader defaults (local to this layout)
    const shaderDefaults = (0, react_1.useMemo)(() => ({
        circle_diameter: 0.84,
        outline_width: 0.01,
        trail_enable: 1,
        trail_spawn_interval: 0.31,
        trail_speed: 0.53,
        trail_shrink_speed: 0.05,
        trail_x_amplitude: 0.03,
        trail_x_frequency: 2.2,
        trail_count_f32: 10,
        trail_opacity: 0.24,
        wobble_x_amp_px: 25,
        wobble_x_freq: 0.75,
        wobble_y_amp_px: 50,
        wobble_y_freq: 0.5,
    }), []);
    // Animate per-input Y offsets to their desired positions (based on desired order)
    const baseYOffset = 360;
    const stepYOffset = 100;
    // Horizontal offset pattern params
    const xStepPx = 140; // base X step
    // Scale reduction per subsequent desired index (10% default)
    const shrinkPercent = 0.1;
    const baseCircleScale = 0.22;
    // Base wobble defaults for organic motion
    const baseWobbleXAmp = 25;
    const baseWobbleYAmp = 50;
    const baseWobbleXFreq = 0.75;
    const baseWobbleYFreq = 0.5;
    // Persistent arrival index per input: used to compute offsets/scale based on count at join time
    const [, setArrivalIndexById] = (0, react_1.useState)({});
    const nextArrivalIndexRef = (0, react_1.useRef)(0);
    (0, react_1.useEffect)(() => {
        setArrivalIndexById(prev => {
            const next = { ...prev };
            // Keep monotonic counter in sync with already assigned indices
            const assignedCount = Object.keys(next).length;
            if (nextArrivalIndexRef.current < assignedCount) {
                nextArrivalIndexRef.current = assignedCount;
            }
            // Assign index to new ids in arrival order
            for (const id of desiredIds) {
                if (!(id in next)) {
                    next[id] = nextArrivalIndexRef.current++;
                }
            }
            // Drop removed ids (counter stays monotonic)
            for (const id of Object.keys(next)) {
                if (!desiredIds.includes(id)) {
                    delete next[id];
                }
            }
            return next;
        });
    }, [desiredIds]);
    // Targets follow desired order (enables swapping animation)
    const targetYOffsetById = (0, react_1.useMemo)(() => buildYOffsetMap(desiredIds, baseYOffset, stepYOffset), [desiredIds]);
    const targetXOffsetById = (0, react_1.useMemo)(() => buildXOffsetMap(desiredIds, xStepPx), [desiredIds, xStepPx]);
    const targetScaleById = (0, react_1.useMemo)(() => buildScaleMap(desiredIds, baseCircleScale, shrinkPercent), [desiredIds, baseCircleScale, shrinkPercent]);
    const { wobbleXAmp: targetWobbleXAmpById, wobbleYAmp: targetWobbleYAmpById, wobbleXFreq: targetWobbleXFreqById, wobbleYFreq: targetWobbleYFreqById, } = (0, react_1.useMemo)(() => buildWobbleMaps(desiredIds, baseWobbleXAmp, baseWobbleYAmp, baseWobbleXFreq, baseWobbleYFreq), [desiredIds]);
    // Persistent hue per input: assign once on first sight, keep even if order changes
    const baseOutlineHue = 0.44;
    const hueStep = 0.1;
    const [hueById, setHueById] = (0, react_1.useState)({});
    // Sequential hue assignment independent of current queue position
    const hueIndexRef = (0, react_1.useRef)(0);
    (0, react_1.useEffect)(() => {
        setHueById(prev => {
            const next = { ...prev };
            // Sync counter with how many are already assigned (monotonic, never decremented)
            const assignedCount = Object.keys(next).length;
            if (hueIndexRef.current < assignedCount) {
                hueIndexRef.current = assignedCount;
            }
            // Assign hues to any new ids in arrival order using the sequential counter
            for (const id of desiredIds) {
                if (!(id in next)) {
                    next[id] = wrapHue(baseOutlineHue + hueIndexRef.current * hueStep);
                    hueIndexRef.current += 1;
                }
            }
            // Drop removed ids (counter stays monotonic)
            for (const id of Object.keys(next)) {
                if (!desiredIds.includes(id)) {
                    delete next[id];
                }
            }
            return next;
        });
    }, [desiredIds]);
    const [yOffsetById, setYOffsetById] = (0, react_1.useState)({});
    const [xOffsetById, setXOffsetById] = (0, react_1.useState)({});
    const [scaleById, setScaleById] = (0, react_1.useState)({});
    const animIntervalRef = (0, react_1.useRef)(null);
    const fromRef = (0, react_1.useRef)({});
    const toRef = (0, react_1.useRef)({});
    const fromXRef = (0, react_1.useRef)({});
    const toXRef = (0, react_1.useRef)({});
    const fromScaleRef = (0, react_1.useRef)({});
    const toScaleRef = (0, react_1.useRef)({});
    // Ensure state keys match current inputs: initialize from arrival-based initial maps
    (0, react_1.useEffect)(() => {
        setYOffsetById(prev => {
            const next = { ...prev };
            const endIdx = Math.max(0, desiredIds.length - 1);
            const initY = baseYOffset - endIdx * stepYOffset;
            for (const id of Object.keys(targetYOffsetById)) {
                if (!(id in next)) {
                    next[id] = initY;
                }
            }
            for (const id of Object.keys(next)) {
                if (!(id in targetYOffsetById)) {
                    delete next[id];
                }
            }
            return next;
        });
    }, [desiredIds, targetYOffsetById, baseYOffset, stepYOffset]);
    (0, react_1.useEffect)(() => {
        setXOffsetById(prev => {
            const next = { ...prev };
            const endIdx = Math.max(0, desiredIds.length - 1);
            const initX = xPatternOffset(endIdx, xStepPx);
            for (const id of Object.keys(targetXOffsetById)) {
                if (!(id in next)) {
                    next[id] = initX;
                }
            }
            for (const id of Object.keys(next)) {
                if (!(id in targetXOffsetById)) {
                    delete next[id];
                }
            }
            return next;
        });
    }, [desiredIds, targetXOffsetById, xStepPx]);
    (0, react_1.useEffect)(() => {
        setScaleById(prev => {
            const next = { ...prev };
            const endIdx = Math.max(0, desiredIds.length - 1);
            const factor = Math.max(0, 1 - shrinkPercent);
            const initScale = baseCircleScale * Math.pow(factor, endIdx);
            for (const id of Object.keys(targetScaleById)) {
                if (!(id in next)) {
                    next[id] = initScale;
                }
            }
            for (const id of Object.keys(next)) {
                if (!(id in targetScaleById)) {
                    delete next[id];
                }
            }
            return next;
        });
    }, [desiredIds, targetScaleById, baseCircleScale, shrinkPercent]);
    // Start tween when target offsets change
    (0, react_1.useEffect)(() => {
        var _a, _b, _c;
        fromRef.current = {};
        toRef.current = {};
        fromXRef.current = {};
        toXRef.current = {};
        fromScaleRef.current = {};
        toScaleRef.current = {};
        let needsAnim = false;
        for (const [id, target] of Object.entries(targetYOffsetById)) {
            const current = (_a = yOffsetById[id]) !== null && _a !== void 0 ? _a : target;
            fromRef.current[id] = current;
            toRef.current[id] = target;
            if (Math.abs(current - target) > 0.5) {
                needsAnim = true;
            }
        }
        for (const [id, target] of Object.entries(targetXOffsetById)) {
            const current = (_b = xOffsetById[id]) !== null && _b !== void 0 ? _b : target;
            fromXRef.current[id] = current;
            toXRef.current[id] = target;
            if (Math.abs(current - target) > 0.5) {
                needsAnim = true;
            }
        }
        for (const [id, target] of Object.entries(targetScaleById)) {
            const current = (_c = scaleById[id]) !== null && _c !== void 0 ? _c : target;
            fromScaleRef.current[id] = current;
            toScaleRef.current[id] = target;
            if (Math.abs(current - target) > 0.001) {
                needsAnim = true;
            }
        }
        if (!needsAnim) {
            return;
        }
        const start = Date.now();
        const tick = () => {
            const t = Math.min(1, (Date.now() - start) / EASING_DURATION_MS);
            const e = easeInOutCubic(t);
            setYOffsetById(prev => {
                var _a;
                const next = { ...prev };
                for (const id of Object.keys(toRef.current)) {
                    const from = (_a = fromRef.current[id]) !== null && _a !== void 0 ? _a : toRef.current[id];
                    const to = toRef.current[id];
                    next[id] = from + (to - from) * e;
                }
                return next;
            });
            setXOffsetById(prev => {
                var _a;
                const next = { ...prev };
                for (const id of Object.keys(toXRef.current)) {
                    const from = (_a = fromXRef.current[id]) !== null && _a !== void 0 ? _a : toXRef.current[id];
                    const to = toXRef.current[id];
                    next[id] = from + (to - from) * e;
                }
                return next;
            });
            setScaleById(prev => {
                var _a;
                const next = { ...prev };
                for (const id of Object.keys(toScaleRef.current)) {
                    const from = (_a = fromScaleRef.current[id]) !== null && _a !== void 0 ? _a : toScaleRef.current[id];
                    const to = toScaleRef.current[id];
                    next[id] = from + (to - from) * e;
                }
                return next;
            });
            if (t >= 1 && animIntervalRef.current) {
                clearInterval(animIntervalRef.current);
                animIntervalRef.current = null;
            }
        };
        if (animIntervalRef.current) {
            clearInterval(animIntervalRef.current);
            animIntervalRef.current = null;
        }
        animIntervalRef.current = setInterval(tick, 16);
        return () => {
            if (animIntervalRef.current) {
                clearInterval(animIntervalRef.current);
                animIntervalRef.current = null;
            }
        };
    }, [targetYOffsetById, targetXOffsetById, targetScaleById]);
    return ((0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { direction: 'column', width: 2560, height: 1440 }, children: [(0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: {
                    rescaleMode: 'fill',
                    horizontalAlign: 'left',
                    verticalAlign: 'top',
                    width: 2560,
                    height: 1440,
                    top: 0,
                    left: 0,
                }, children: (0, jsx_runtime_1.jsx)(smelter_1.Shader, { shaderId: "star-streaks", resolution: { width: 2560, height: 1440 }, shaderParam: {
                        type: 'struct',
                        value: [
                            { type: 'f32', fieldName: 'line_density', value: 18.91 },
                            { type: 'f32', fieldName: 'thickness_px', value: 2.0 },
                            { type: 'f32', fieldName: 'speed', value: 2.45 },
                            { type: 'f32', fieldName: 'jitter_amp_px', value: 48.0 },
                            { type: 'f32', fieldName: 'jitter_freq', value: 0.15 },
                            { type: 'f32', fieldName: 'dash_repeat', value: 2.0 },
                            { type: 'f32', fieldName: 'dash_duty', value: 0.19 },
                            { type: 'f32', fieldName: 'brightness', value: 0.26 },
                        ],
                    }, children: (0, jsx_runtime_1.jsx)(smelter_1.View, { style: { width: 2560, height: 1440, backgroundColor: '#000000', direction: 'column' } }) }) }), desiredIds.map((id, renderIdx) => {
                var _a, _b, _c, _d, _e, _f, _g, _h;
                const input = inputById[id];
                if (!input) {
                    return null;
                }
                // Prefer animated state; fallback to targets (dependent on current order)
                const yOffset = (_a = (id in yOffsetById ? yOffsetById[id] : targetYOffsetById[id])) !== null && _a !== void 0 ? _a : baseYOffset - renderIdx * stepYOffset;
                const xOffset = (_b = (id in xOffsetById ? xOffsetById[id] : targetXOffsetById[id])) !== null && _b !== void 0 ? _b : 0;
                const circleScale = (_c = (id in scaleById ? scaleById[id] : targetScaleById[id])) !== null && _c !== void 0 ? _c : baseCircleScale;
                return ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: {
                        rescaleMode: 'fill',
                        horizontalAlign: 'left',
                        verticalAlign: 'top',
                        width: Math.round(2560),
                        height: Math.round(1440),
                        top: 0,
                        left: 0,
                    }, children: (0, jsx_runtime_1.jsx)(smelter_1.Shader, { shaderId: "circle-mask-outline", resolution: { width: 1920, height: 1080 }, shaderParam: {
                            type: 'struct',
                            value: [
                                // Global, user-adjustable defaults (non-animated)
                                {
                                    type: 'f32',
                                    fieldName: 'circle_diameter',
                                    value: shaderDefaults.circle_diameter,
                                },
                                { type: 'f32', fieldName: 'outline_width', value: shaderDefaults.outline_width },
                                { type: 'f32', fieldName: 'outline_hue', value: (_d = hueById[id]) !== null && _d !== void 0 ? _d : 0.44 },
                                { type: 'f32', fieldName: 'circle_scale', value: circleScale },
                                { type: 'f32', fieldName: 'circle_offset_x_px', value: xOffset },
                                // Animated per-input vertical offset
                                { type: 'f32', fieldName: 'circle_offset_y_px', value: yOffset },
                                // Free oscillation (organic per input)
                                {
                                    type: 'f32',
                                    fieldName: 'wobble_x_amp_px',
                                    value: (_e = targetWobbleXAmpById[id]) !== null && _e !== void 0 ? _e : baseWobbleXAmp,
                                },
                                {
                                    type: 'f32',
                                    fieldName: 'wobble_x_freq',
                                    value: (_f = targetWobbleXFreqById[id]) !== null && _f !== void 0 ? _f : baseWobbleXFreq,
                                },
                                {
                                    type: 'f32',
                                    fieldName: 'wobble_y_amp_px',
                                    value: (_g = targetWobbleYAmpById[id]) !== null && _g !== void 0 ? _g : baseWobbleYAmp,
                                },
                                {
                                    type: 'f32',
                                    fieldName: 'wobble_y_freq',
                                    value: (_h = targetWobbleYFreqById[id]) !== null && _h !== void 0 ? _h : baseWobbleYFreq,
                                },
                                // Trail defaults
                                { type: 'f32', fieldName: 'trail_enable', value: shaderDefaults.trail_enable },
                                {
                                    type: 'f32',
                                    fieldName: 'trail_spawn_interval',
                                    value: shaderDefaults.trail_spawn_interval,
                                },
                                { type: 'f32', fieldName: 'trail_speed', value: shaderDefaults.trail_speed },
                                {
                                    type: 'f32',
                                    fieldName: 'trail_shrink_speed',
                                    value: shaderDefaults.trail_shrink_speed,
                                },
                                {
                                    type: 'f32',
                                    fieldName: 'trail_x_amplitude',
                                    value: shaderDefaults.trail_x_amplitude,
                                },
                                {
                                    type: 'f32',
                                    fieldName: 'trail_x_frequency',
                                    value: shaderDefaults.trail_x_frequency,
                                },
                                {
                                    type: 'f32',
                                    fieldName: 'trail_count_f32',
                                    value: shaderDefaults.trail_count_f32,
                                },
                                { type: 'f32', fieldName: 'trail_opacity', value: shaderDefaults.trail_opacity },
                            ],
                        }, children: (0, jsx_runtime_1.jsxs)(smelter_1.View, { style: {
                                direction: 'column',
                                overflow: 'visible',
                                top: 0,
                                left: 0,
                                width: 1920,
                                height: 1080,
                            }, children: [(0, jsx_runtime_1.jsx)(inputs_1.Input, { input: input }), (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: { fontSize: 80, color: '#ffffff' }, children: "420" })] }) }) }, input.inputId));
            })] }));
}
