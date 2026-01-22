"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = App;
const jsx_runtime_1 = require("react/jsx-runtime");
const smelter_1 = require("@swmansion/smelter");
const zustand_1 = require("zustand");
const react_1 = require("react");
const store_1 = require("./store");
const layouts_1 = require("./layouts");
function App({ store }) {
    return ((0, jsx_runtime_1.jsx)(store_1.StoreContext.Provider, { value: store, children: (0, jsx_runtime_1.jsx)(OutputScene, {}) }));
}
function OutputScene() {
    const store = (0, react_1.useContext)(store_1.StoreContext);
    const layout = (0, zustand_1.useStore)(store, state => state.layout);
    return ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: { backgroundColor: '#000000', padding: 0 }, children: layout === 'grid' ? ((0, jsx_runtime_1.jsx)(layouts_1.GridLayout, {})) : layout === 'primary-on-top' ? ((0, jsx_runtime_1.jsx)(layouts_1.PrimaryOnTopLayout, {})) : layout === 'primary-on-left' ? ((0, jsx_runtime_1.jsx)(layouts_1.PrimaryOnLeftLayout, {})) : layout === 'picture-in-picture' ? ((0, jsx_runtime_1.jsx)(layouts_1.PictureInPictureLayout, {})) : layout === 'wrapped' ? ((0, jsx_runtime_1.jsx)(layouts_1.WrappedLayout, {})) : layout === 'wrapped-static' ? ((0, jsx_runtime_1.jsx)(layouts_1.WrappedStaticLayout, {})) : layout === 'transition' ? ((0, jsx_runtime_1.jsx)(layouts_1.TransitionLayout, {})) : null }));
}
