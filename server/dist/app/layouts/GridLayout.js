"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GridLayout = GridLayout;
const jsx_runtime_1 = require("react/jsx-runtime");
const smelter_1 = require("@swmansion/smelter");
const react_1 = require("react");
const zustand_1 = require("zustand");
const store_1 = require("../store");
const inputs_1 = require("../../inputs/inputs");
function GridLayout() {
    const store = (0, react_1.useContext)(store_1.StoreContext);
    const inputs = (0, zustand_1.useStore)(store, state => state.inputs);
    const resolution = (0, store_1.useResolution)();
    const isVertical = (0, store_1.useIsVertical)();
    const tileAspectRatio = isVertical
        ? `${resolution.width}:${Math.round(resolution.width * 0.63)}`
        : `${resolution.width}:${Math.round(resolution.width * 0.63)}`;
    return ((0, jsx_runtime_1.jsx)(smelter_1.Tiles, { transition: { durationMs: 300 }, style: { padding: 20, tileAspectRatio }, children: Object.values(inputs).map(input => ((0, jsx_runtime_1.jsx)(inputs_1.Input, { input: input }, input.inputId))) }));
}
