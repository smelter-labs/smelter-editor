"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoreContext = exports.Layouts = void 0;
exports.createRoomStore = createRoomStore;
exports.useResolution = useResolution;
exports.useIsVertical = useIsVertical;
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
];
function createRoomStore(resolution = { width: 2560, height: 1440 }) {
    return (0, zustand_1.createStore)(set => ({
        inputs: [],
        layout: 'grid',
        resolution,
        updateState: (inputs, layout) => {
            set(_state => ({ inputs, layout }));
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
exports.StoreContext = (0, react_1.createContext)(createRoomStore());
