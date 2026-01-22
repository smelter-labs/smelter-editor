"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoreContext = exports.Layouts = void 0;
exports.createRoomStore = createRoomStore;
const zustand_1 = require("zustand");
const react_1 = require("react");
exports.Layouts = [
    'grid',
    'primary-on-left',
    'primary-on-top',
    'picture-in-picture',
    'wrapped',
    'wrapped-static',
    'transition',
];
function createRoomStore() {
    return (0, zustand_1.createStore)(set => ({
        inputs: [],
        layout: 'grid',
        updateState: (inputs, layout) => {
            set(_state => ({ inputs, layout }));
        },
    }));
}
exports.StoreContext = (0, react_1.createContext)(createRoomStore());
