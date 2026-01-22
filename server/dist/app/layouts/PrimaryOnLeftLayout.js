"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrimaryOnLeftLayout = PrimaryOnLeftLayout;
const jsx_runtime_1 = require("react/jsx-runtime");
const smelter_1 = require("@swmansion/smelter");
const react_1 = require("react");
const zustand_1 = require("zustand");
const store_1 = require("../store");
const inputs_1 = require("../../inputs/inputs");
function PrimaryOnLeftLayout() {
    const store = (0, react_1.useContext)(store_1.StoreContext);
    const inputs = (0, zustand_1.useStore)(store, state => state.inputs);
    const firstInput = inputs[0];
    if (!firstInput) {
        return (0, jsx_runtime_1.jsx)(smelter_1.View, {});
    }
    return ((0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { direction: 'row' }, children: [(0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { width: 1500 }, children: (0, jsx_runtime_1.jsx)(inputs_1.Input, { input: firstInput }) }), (0, jsx_runtime_1.jsx)(smelter_1.Tiles, { transition: { durationMs: 300 }, style: { padding: 10 }, children: Object.values(inputs)
                    .filter(input => input.inputId != firstInput.inputId)
                    .map(input => ((0, jsx_runtime_1.jsx)(inputs_1.SmallInput, { input: input }, input.inputId))) })] }));
}
