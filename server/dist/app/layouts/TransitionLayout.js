"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransitionLayout = TransitionLayout;
const jsx_runtime_1 = require("react/jsx-runtime");
const smelter_1 = require("@swmansion/smelter");
const react_1 = require("react");
const zustand_1 = require("zustand");
const store_1 = require("../store");
const inputs_1 = require("../../inputs/inputs");
function TransitionLayout() {
    const store = (0, react_1.useContext)(store_1.StoreContext);
    const inputs = (0, zustand_1.useStore)(store, state => state.inputs);
    const inputA = inputs[0];
    const inputB = inputs[1];
    const speedDefault = 0.25;
    const pauseSeconds = 3;
    const intervalMs = 10;
    const [progress, setProgress] = (0, react_1.useState)(0);
    const directionRef = (0, react_1.useRef)(1);
    const speedRef = (0, react_1.useRef)(speedDefault);
    (0, react_1.useEffect)(() => {
        let timer = null;
        let pauseTimer = null;
        function startAnimation() {
            timer = setInterval(() => {
                setProgress(prev => {
                    let next = prev + directionRef.current * speedRef.current * (intervalMs / 1000);
                    if (directionRef.current === 1 && next >= 1) {
                        next = 1;
                        clearInterval(timer);
                        timer = null;
                        pauseTimer = setTimeout(() => {
                            directionRef.current = -1;
                            startAnimation();
                        }, pauseSeconds * 1000);
                    }
                    else if (directionRef.current === -1 && next <= 0) {
                        next = 0;
                        clearInterval(timer);
                        timer = null;
                        pauseTimer = setTimeout(() => {
                            directionRef.current = 1;
                            startAnimation();
                        }, pauseSeconds * 1000);
                    }
                    return Math.max(0, Math.min(1, next));
                });
            }, intervalMs);
        }
        startAnimation();
        return () => {
            if (timer) {
                clearInterval(timer);
            }
            if (pauseTimer) {
                clearTimeout(pauseTimer);
            }
        };
    }, []);
    if (!inputA) {
        return (0, jsx_runtime_1.jsx)(smelter_1.View, {});
    }
    const resolution = { width: 1920, height: 1080 };
    let showFirst, showSecond;
    if (progress < 0.5) {
        showFirst = inputA;
        showSecond = inputB;
    }
    else {
        showFirst = inputB;
        showSecond = inputA;
    }
    if (!showFirst) {
        return (0, jsx_runtime_1.jsx)(smelter_1.View, {});
    }
    return ((0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { direction: 'column', width: 2560, height: 1440 }, children: [(0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: {
                    rescaleMode: 'fill',
                    horizontalAlign: 'left',
                    verticalAlign: 'top',
                    width: 2560,
                    height: 1440,
                    top: 0,
                    left: 0,
                }, children: (0, jsx_runtime_1.jsx)(smelter_1.Shader, { shaderId: "page-flip-1", resolution: resolution, shaderParam: {
                        type: 'struct',
                        value: [
                            { type: 'f32', fieldName: 'progress', value: progress },
                            { type: 'f32', fieldName: 'direction', value: 0 },
                            { type: 'f32', fieldName: 'perspective', value: 1 },
                            { type: 'f32', fieldName: 'shadow_strength', value: 0.75 },
                            { type: 'f32', fieldName: 'back_tint', value: 0.45 },
                            { type: 'f32', fieldName: 'back_tint_strength', value: 0.33 },
                        ],
                    }, children: showFirst ? (0, jsx_runtime_1.jsx)(inputs_1.Input, { input: showFirst }) : (0, jsx_runtime_1.jsx)(smelter_1.View, {}) }) }), showSecond ? ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: {
                    rescaleMode: 'fill',
                    horizontalAlign: 'left',
                    verticalAlign: 'top',
                    top: 0,
                    left: 0,
                }, children: (0, jsx_runtime_1.jsx)(smelter_1.Shader, { shaderId: "page-flip-1", resolution: resolution, shaderParam: {
                        type: 'struct',
                        value: [
                            { type: 'f32', fieldName: 'progress', value: progress },
                            { type: 'f32', fieldName: 'direction', value: 0 },
                            { type: 'f32', fieldName: 'perspective', value: 1 },
                            { type: 'f32', fieldName: 'shadow_strength', value: 0.75 },
                            { type: 'f32', fieldName: 'back_tint', value: 0.45 },
                            { type: 'f32', fieldName: 'back_tint_strength', value: 0.33 },
                        ],
                    }, children: showSecond ? (0, jsx_runtime_1.jsx)(inputs_1.Input, { input: showSecond }) : (0, jsx_runtime_1.jsx)(smelter_1.View, {}) }) })) : null] }));
}
