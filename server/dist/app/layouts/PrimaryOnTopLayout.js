"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrimaryOnTopLayout = PrimaryOnTopLayout;
const jsx_runtime_1 = require("react/jsx-runtime");
const smelter_1 = require("@swmansion/smelter");
const react_1 = require("react");
const zustand_1 = require("zustand");
const store_1 = require("../store");
const inputs_1 = require("../../inputs/inputs");
const usePrimarySwapTransition_1 = require("./usePrimarySwapTransition");
const usePostSwapFadeIn_1 = require("./usePostSwapFadeIn");
const TILES_PADDING = 10;
function PrimaryOnTopLayout() {
    const store = (0, react_1.useContext)(store_1.StoreContext);
    const inputs = (0, zustand_1.useStore)(store, state => state.inputs);
    const resolution = (0, store_1.useResolution)();
    const isVertical = (0, store_1.useIsVertical)();
    const swapDurationMs = (0, store_1.useSwapDurationMs)();
    const swapOutgoingEnabled = (0, store_1.useSwapOutgoingEnabled)();
    const swapFadeInDurationMs = (0, store_1.useSwapFadeInDurationMs)();
    const firstInput = inputs[0];
    const swap = (0, usePrimarySwapTransition_1.usePrimarySwapTransition)(inputs, swapDurationMs);
    const fadeOpacity = (0, usePostSwapFadeIn_1.usePostSwapFadeIn)(swap.isTransitioning, swapFadeInDurationMs);
    if (!firstInput) {
        return (0, jsx_runtime_1.jsx)(smelter_1.View, {});
    }
    const primaryHeight = Math.round(resolution.height * 0.55);
    const secondaryHeight = resolution.height - primaryHeight;
    const smallInputs = inputs.filter(input => input.inputId !== firstInput.inputId);
    const prevTileCount = Math.max(1, swap.prevSecondaryCount);
    const tileW = Math.round((resolution.width - TILES_PADDING * (prevTileCount + 1)) / prevTileCount);
    const tileH = secondaryHeight - TILES_PADDING * 2;
    const incomingStartTop = primaryHeight + TILES_PADDING;
    const incomingStartLeft = TILES_PADDING + swap.incomingPrevIndex * (tileW + TILES_PADDING);
    return ((0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { width: resolution.width, height: resolution.height, overflow: 'visible' }, children: [(0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { width: resolution.width, height: resolution.height, direction: 'column', top: 0, left: 0 }, children: [(0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { width: resolution.width, height: primaryHeight }, children: [(0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { height: primaryHeight }, children: (0, jsx_runtime_1.jsx)(inputs_1.Input, { input: firstInput }) }), swap.isTransitioning && swap.outgoingInput && ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: {
                                    top: 0,
                                    left: 0,
                                    width: swapOutgoingEnabled
                                        ? resolution.width - swap.progress * (resolution.width - tileW)
                                        : resolution.width,
                                    height: swapOutgoingEnabled
                                        ? primaryHeight - swap.progress * (primaryHeight - tileH)
                                        : primaryHeight,
                                }, children: (0, jsx_runtime_1.jsx)(inputs_1.Input, { input: swap.outgoingInput }) }))] }), (0, jsx_runtime_1.jsx)(smelter_1.Shader, { shaderId: "opacity", resolution: { width: resolution.width, height: secondaryHeight }, shaderParam: { type: 'struct', value: [{ type: 'f32', fieldName: 'opacity', value: fadeOpacity }] }, children: (0, jsx_runtime_1.jsx)(smelter_1.View, { style: { width: resolution.width, height: secondaryHeight }, children: (0, jsx_runtime_1.jsx)(smelter_1.Tiles, { transition: { durationMs: 300 }, style: { padding: TILES_PADDING }, children: smallInputs.map(input => ((0, jsx_runtime_1.jsx)(inputs_1.SmallInput, { input: input }, input.inputId))) }) }) })] }), swap.isTransitioning && swap.incomingInput && ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: {
                    top: incomingStartTop + swap.progress * (0 - incomingStartTop),
                    left: incomingStartLeft + swap.progress * (0 - incomingStartLeft),
                    width: tileW + swap.progress * (resolution.width - tileW),
                    height: tileH + swap.progress * (primaryHeight - tileH),
                }, children: (0, jsx_runtime_1.jsx)(inputs_1.Input, { input: swap.incomingInput }) }))] }));
}
