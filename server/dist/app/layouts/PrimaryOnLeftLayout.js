"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrimaryOnLeftLayout = PrimaryOnLeftLayout;
const jsx_runtime_1 = require("react/jsx-runtime");
const smelter_1 = require("@swmansion/smelter");
const react_1 = require("react");
const zustand_1 = require("zustand");
const store_1 = require("../store");
const inputs_1 = require("../../inputs/inputs");
const usePrimarySwapTransition_1 = require("./usePrimarySwapTransition");
const usePostSwapFadeIn_1 = require("./usePostSwapFadeIn");
const TILES_PADDING = 10;
function PrimaryOnLeftLayout() {
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
    const primaryWidth = isVertical
        ? resolution.width
        : Math.round(resolution.width * 0.6);
    const primaryHeight = isVertical
        ? Math.round(resolution.height * 0.6)
        : resolution.height;
    const secondaryWidth = isVertical ? resolution.width : resolution.width - primaryWidth;
    const secondaryHeight = isVertical ? resolution.height - primaryHeight : resolution.height;
    const smallInputs = inputs.filter(input => input.inputId !== firstInput.inputId);
    const prevTileCount = Math.max(1, swap.prevSecondaryCount);
    let incomingStartTop;
    let incomingStartLeft;
    let tileW;
    let tileH;
    if (isVertical) {
        tileW = Math.round((secondaryWidth - TILES_PADDING * (prevTileCount + 1)) / prevTileCount);
        tileH = secondaryHeight - TILES_PADDING * 2;
        incomingStartTop = primaryHeight + TILES_PADDING;
        incomingStartLeft = TILES_PADDING + swap.incomingPrevIndex * (tileW + TILES_PADDING);
    }
    else {
        tileW = secondaryWidth - TILES_PADDING * 2;
        tileH = Math.round((secondaryHeight - TILES_PADDING * (prevTileCount + 1)) / prevTileCount);
        incomingStartTop = TILES_PADDING + swap.incomingPrevIndex * (tileH + TILES_PADDING);
        incomingStartLeft = primaryWidth + TILES_PADDING;
    }
    return ((0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { width: resolution.width, height: resolution.height, overflow: 'visible' }, children: [(0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { width: resolution.width, height: resolution.height, direction: isVertical ? 'column' : 'row', top: 0, left: 0 }, children: [(0, jsx_runtime_1.jsxs)(smelter_1.View, { style: isVertical ? { width: resolution.width, height: primaryHeight } : { width: primaryWidth, height: resolution.height }, children: [(0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: isVertical ? { height: primaryHeight } : { width: primaryWidth }, children: (0, jsx_runtime_1.jsx)(inputs_1.Input, { input: firstInput }) }), swap.isTransitioning && swap.outgoingInput && ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: {
                                    top: 0,
                                    left: 0,
                                    width: swapOutgoingEnabled
                                        ? (isVertical
                                            ? resolution.width - swap.progress * (resolution.width - tileW)
                                            : primaryWidth - swap.progress * (primaryWidth - tileW))
                                        : (isVertical ? resolution.width : primaryWidth),
                                    height: swapOutgoingEnabled
                                        ? (isVertical
                                            ? primaryHeight - swap.progress * (primaryHeight - tileH)
                                            : resolution.height - swap.progress * (resolution.height - tileH))
                                        : (isVertical ? primaryHeight : resolution.height),
                                }, children: (0, jsx_runtime_1.jsx)(inputs_1.Input, { input: swap.outgoingInput }) }))] }), (0, jsx_runtime_1.jsx)(smelter_1.Shader, { shaderId: "opacity", resolution: { width: secondaryWidth, height: secondaryHeight }, shaderParam: { type: 'struct', value: [{ type: 'f32', fieldName: 'opacity', value: fadeOpacity }] }, children: (0, jsx_runtime_1.jsx)(smelter_1.View, { style: { width: secondaryWidth, height: secondaryHeight }, children: (0, jsx_runtime_1.jsx)(smelter_1.Tiles, { transition: { durationMs: 300 }, style: { padding: TILES_PADDING }, children: smallInputs.map(input => ((0, jsx_runtime_1.jsx)(inputs_1.SmallInput, { input: input }, input.inputId))) }) }) })] }), swap.isTransitioning && swap.incomingInput && ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: {
                    top: incomingStartTop + swap.progress * (0 - incomingStartTop),
                    left: incomingStartLeft + swap.progress * (0 - incomingStartLeft),
                    width: tileW + swap.progress * ((isVertical ? resolution.width : primaryWidth) - tileW),
                    height: tileH + swap.progress * ((isVertical ? primaryHeight : resolution.height) - tileH),
                }, children: (0, jsx_runtime_1.jsx)(inputs_1.Input, { input: swap.incomingInput }) }))] }));
}
