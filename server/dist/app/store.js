"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoreContext = exports.Layouts = void 0;
exports.createRoomStore = createRoomStore;
exports.useResolution = useResolution;
exports.useIsVertical = useIsVertical;
exports.useSwapDurationMs = useSwapDurationMs;
exports.useSwapOutgoingEnabled = useSwapOutgoingEnabled;
exports.useSwapFadeInDurationMs = useSwapFadeInDurationMs;
exports.useNewsStripFadeDuringSwap = useNewsStripFadeDuringSwap;
const zustand_1 = require("zustand");
const react_1 = require("react");
const zustand_2 = require("zustand");
exports.Layouts = [
    'grid',
    'primary-on-left',
    'primary-on-top',
    'picture-in-picture',
    'wrapped',
    'wrapped-static',
    'transition',
    'picture-on-picture',
    'softu-tv',
];
function createRoomStore(resolution = { width: 2560, height: 1440 }) {
    return (0, zustand_1.createStore)(set => ({
        inputs: [],
        layout: 'grid',
        resolution,
        swapDurationMs: 500,
        swapOutgoingEnabled: true,
        swapFadeInDurationMs: 500,
        newsStripFadeDuringSwap: true,
        updateState: (inputs, layout, swapDurationMs, swapOutgoingEnabled, swapFadeInDurationMs, newsStripFadeDuringSwap) => {
            set(_state => ({ inputs, layout, swapDurationMs, swapOutgoingEnabled, swapFadeInDurationMs, newsStripFadeDuringSwap }));
        },
    }));
}
function useResolution() {
    const store = (0, react_1.useContext)(exports.StoreContext);
    return (0, zustand_2.useStore)(store, state => state.resolution);
}
function useIsVertical() {
    const resolution = useResolution();
    return resolution.height > resolution.width;
}
function useSwapDurationMs() {
    const store = (0, react_1.useContext)(exports.StoreContext);
    return (0, zustand_2.useStore)(store, state => state.swapDurationMs);
}
function useSwapOutgoingEnabled() {
    const store = (0, react_1.useContext)(exports.StoreContext);
    return (0, zustand_2.useStore)(store, state => state.swapOutgoingEnabled);
}
function useSwapFadeInDurationMs() {
    const store = (0, react_1.useContext)(exports.StoreContext);
    return (0, zustand_2.useStore)(store, state => state.swapFadeInDurationMs);
}
function useNewsStripFadeDuringSwap() {
    const store = (0, react_1.useContext)(exports.StoreContext);
    return (0, zustand_2.useStore)(store, state => state.newsStripFadeDuringSwap);
}
exports.StoreContext = (0, react_1.createContext)(createRoomStore());
