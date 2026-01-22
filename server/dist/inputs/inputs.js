"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Input = Input;
exports.SmallInput = SmallInput;
const jsx_runtime_1 = require("react/jsx-runtime");
const smelter_1 = require("@swmansion/smelter");
function wrapWithShaders(component, shaders, resolution, index = 0) {
    if (!shaders || index >= shaders.length) {
        return component;
    }
    const shader = shaders[index];
    const shaderParams = Array.isArray(shader.params)
        ? shader.params.map((param) => ({
            type: 'f32',
            fieldName: param.paramName,
            value: param.paramValue,
        }))
        : [];
    return ((0, jsx_runtime_1.jsx)(smelter_1.Shader, { shaderId: shader.shaderId, resolution: resolution, shaderParam: shaderParams.length > 0
            ? {
                type: 'struct',
                value: shaderParams,
            }
            : undefined, children: wrapWithShaders(component, shaders, resolution, index + 1) }));
}
function Input({ input }) {
    var _a, _b, _c;
    const streams = (0, smelter_1.useInputStreams)();
    const isImage = !!input.imageId;
    const isTextInput = !!input.text;
    const streamState = isImage || isTextInput ? 'playing' : ((_b = (_a = streams[input.inputId]) === null || _a === void 0 ? void 0 : _a.videoState) !== null && _b !== void 0 ? _b : 'finished');
    const resolution = { width: 1920, height: 1080 };
    const inputComponent = ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: resolution, children: (0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { ...resolution, direction: 'column' }, children: [streamState === 'playing' ? (isImage ? ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fit' }, children: (0, jsx_runtime_1.jsx)(smelter_1.Image, { imageId: input.imageId }) })) : isTextInput ? ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: { width: 1920, height: 1080, backgroundColor: '#1a1a2e', padding: 100 }, children: (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: { fontSize: 80, color: 'white', align: (_c = input.textAlign) !== null && _c !== void 0 ? _c : 'left' }, children: input.text }) })) : ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fill' }, children: (0, jsx_runtime_1.jsx)(smelter_1.InputStream, { inputId: input.inputId, volume: input.volume }) }))) : streamState === 'ready' ? ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: { padding: 300 }, children: (0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fit' }, children: (0, jsx_runtime_1.jsx)(smelter_1.Image, { imageId: "spinner" }) }) })) : streamState === 'finished' ? ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: { padding: 300 }, children: (0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fit' }, children: (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: { fontSize: 600 }, children: "Stream offline" }) }) })) : ((0, jsx_runtime_1.jsx)(smelter_1.View, {})), input.showTitle !== false && ((0, jsx_runtime_1.jsxs)(smelter_1.View, { style: {
                        backgroundColor: '#493880',
                        height: 90,
                        padding: 20,
                        borderRadius: 0,
                        direction: 'column',
                        overflow: 'visible',
                        bottom: 0,
                        left: 0,
                    }, children: [(0, jsx_runtime_1.jsx)(smelter_1.Text, { style: { fontSize: 40, color: 'white' }, children: input === null || input === void 0 ? void 0 : input.title }), (0, jsx_runtime_1.jsx)(smelter_1.View, { style: { height: 10 } }), (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: { fontSize: 25, color: 'white' }, children: input === null || input === void 0 ? void 0 : input.description })] }))] }) }));
    const activeShaders = input.shaders.filter(shader => shader.enabled);
    return wrapWithShaders(inputComponent, activeShaders, resolution, 0);
}
function SmallInput({ input, resolution = { width: 640, height: 360 }, }) {
    var _a;
    const activeShaders = input.shaders.filter(shader => shader.enabled);
    const isImage = !!input.imageId;
    const isTextInput = !!input.text;
    const smallInputComponent = ((0, jsx_runtime_1.jsxs)(smelter_1.View, { style: {
            width: resolution.width,
            height: resolution.height,
            direction: 'column',
            overflow: 'visible',
        }, children: [isImage ? ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fit' }, children: (0, jsx_runtime_1.jsx)(smelter_1.Image, { imageId: input.imageId }) })) : isTextInput ? ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: { width: resolution.width, height: resolution.height, backgroundColor: '#1a1a2e', padding: 30 }, children: (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: { fontSize: 30, color: 'white', align: (_a = input.textAlign) !== null && _a !== void 0 ? _a : 'left' }, children: input.text }) })) : ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fill' }, children: (0, jsx_runtime_1.jsx)(smelter_1.InputStream, { inputId: input.inputId, volume: input.volume }) })), input.showTitle !== false && ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: {
                    backgroundColor: '#493880',
                    height: 40,
                    padding: 20,
                    borderRadius: 0,
                    direction: 'column',
                    overflow: 'visible',
                    bottom: 0,
                    left: 0,
                }, children: (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: { fontSize: 30, color: 'white' }, children: input.title }) }))] }));
    if (activeShaders.length) {
        return ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { children: wrapWithShaders(smallInputComponent, activeShaders, resolution, 0) }));
    }
    return (0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { children: smallInputComponent });
}
