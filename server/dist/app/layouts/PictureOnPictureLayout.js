"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PictureOnPictureLayout = PictureOnPictureLayout;
const jsx_runtime_1 = require("react/jsx-runtime");
const smelter_1 = require("@swmansion/smelter");
const react_1 = require("react");
const zustand_1 = require("zustand");
const store_1 = require("../store");
const inputs_1 = require("../../inputs/inputs");
function PictureOnPictureLayout() {
    const store = (0, react_1.useContext)(store_1.StoreContext);
    const inputs = (0, zustand_1.useStore)(store, state => state.inputs);
    if (!inputs.length) {
        return (0, jsx_runtime_1.jsx)(smelter_1.View, {});
    }
    return ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: { width: 2560, height: 1440, direction: 'column', overflow: 'visible' }, children: inputs.map((input) => ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: {
                width: 2560,
                height: 1440,
                top: 0,
                left: 0,
            }, children: (0, jsx_runtime_1.jsx)(inputs_1.Input, { input: input }) }, input.inputId))) }));
}
