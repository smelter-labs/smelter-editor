"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Input = Input;
exports.SmallInput = SmallInput;
const jsx_runtime_1 = require("react/jsx-runtime");
const smelter_1 = require("@swmansion/smelter");
const react_1 = require("react");
const shaders_1 = __importDefault(require("../shaders/shaders"));
/**
 * Converts a hex color string to RGB values (0-1 range)
 */
function hexToRgb(hex) {
    // Remove # if present
    const cleanHex = hex.replace('#', '');
    // Handle 3-digit hex
    const fullHex = cleanHex.length === 3
        ? cleanHex.split('').map(char => char + char).join('')
        : cleanHex;
    const r = parseInt(fullHex.substring(0, 2), 16) / 255;
    const g = parseInt(fullHex.substring(2, 4), 16) / 255;
    const b = parseInt(fullHex.substring(4, 6), 16) / 255;
    return { r, g, b };
}
/**
 * Converts a color value (hex string or number) to RGB
 * If it's a number, treats it as a packed integer (0xRRGGBB)
 */
function colorToRgb(colorValue) {
    if (typeof colorValue === 'string') {
        return hexToRgb(colorValue);
    }
    // Treat as packed integer: 0xRRGGBB
    const r = ((colorValue >> 16) & 0xff) / 255;
    const g = ((colorValue >> 8) & 0xff) / 255;
    const b = (colorValue & 0xff) / 255;
    return { r, g, b };
}
function wrapWithShaders(component, shaders, resolution, index) {
    if (!shaders || shaders.length === 0) {
        return component;
    }
    const currentIndex = index !== null && index !== void 0 ? index : shaders.length - 1;
    if (currentIndex < 0) {
        return component;
    }
    const shader = shaders[currentIndex];
    const shaderDef = shaders_1.default.getShaderById(shader.shaderId);
    const shaderParams = [];
    if ((shaderDef === null || shaderDef === void 0 ? void 0 : shaderDef.params) && Array.isArray(shader.params)) {
        for (const paramDef of shaderDef.params) {
            const param = shader.params.find(p => p.paramName === paramDef.name);
            if (!param)
                continue;
            if (paramDef.type === 'color') {
                const baseName = param.paramName;
                const colorValue = param.paramValue;
                const rgb = colorToRgb(colorValue);
                shaderParams.push({
                    type: 'f32',
                    fieldName: `${baseName}_r`,
                    value: rgb.r,
                });
                shaderParams.push({
                    type: 'f32',
                    fieldName: `${baseName}_g`,
                    value: rgb.g,
                });
                shaderParams.push({
                    type: 'f32',
                    fieldName: `${baseName}_b`,
                    value: rgb.b,
                });
            }
            else {
                shaderParams.push({
                    type: 'f32',
                    fieldName: param.paramName,
                    value: param.paramValue,
                });
            }
        }
    }
    return ((0, jsx_runtime_1.jsx)(smelter_1.Shader, { shaderId: shader.shaderId, resolution: resolution, shaderParam: shaderParams.length > 0
            ? {
                type: 'struct',
                value: shaderParams,
            }
            : undefined, children: wrapWithShaders(component, shaders, resolution, currentIndex - 1) }));
}
function ScrollingText({ text, maxLines, scrollSpeed, scrollLoop, fontSize, color, align, containerWidth, containerHeight, }) {
    const lineHeight = fontSize * 1.2;
    const visibleHeight = maxLines > 0 ? maxLines * lineHeight : containerHeight;
    const lines = text.split('\n');
    const totalTextHeight = lines.length * lineHeight;
    const shouldAnimate = maxLines > 0;
    const [scrollOffset, setScrollOffset] = (0, react_1.useState)(0);
    const timerRef = (0, react_1.useRef)(null);
    const prevTextRef = (0, react_1.useRef)('');
    const initializedRef = (0, react_1.useRef)(false);
    (0, react_1.useEffect)(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (!shouldAnimate) {
            setScrollOffset(0);
            return;
        }
        const textChanged = text !== prevTextRef.current;
        const isFirstRun = !initializedRef.current;
        prevTextRef.current = text;
        initializedRef.current = true;
        if (isFirstRun || textChanged) {
            setScrollOffset(visibleHeight);
        }
        const targetPosition = -totalTextHeight;
        const intervalMs = 16;
        const pixelsPerFrame = (scrollSpeed / 1000) * intervalMs;
        timerRef.current = setInterval(() => {
            setScrollOffset(prev => {
                if (prev <= targetPosition) {
                    if (scrollLoop) {
                        return visibleHeight;
                    }
                    if (timerRef.current) {
                        clearInterval(timerRef.current);
                        timerRef.current = null;
                    }
                    return targetPosition;
                }
                return prev - pixelsPerFrame;
            });
        }, intervalMs);
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [text, shouldAnimate, totalTextHeight, visibleHeight, scrollSpeed, scrollLoop]);
    const textTopOffset = shouldAnimate ? scrollOffset : 0;
    return ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: {
            width: containerWidth,
            height: visibleHeight,
            overflow: 'hidden',
        }, children: (0, jsx_runtime_1.jsx)(smelter_1.View, { style: {
                width: containerWidth,
                height: totalTextHeight,
                top: textTopOffset,
                left: 0,
            }, children: (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: {
                    fontSize,
                    width: containerWidth,
                    color,
                    wrap: 'word',
                    align,
                    fontFamily: 'Star Jedi',
                }, children: text }) }) }));
}
function Input({ input }) {
    var _a, _b, _c, _d, _e, _f, _g;
    const streams = (0, smelter_1.useInputStreams)();
    const isImage = !!input.imageId;
    const isTextInput = !!input.text;
    const streamState = isImage || isTextInput ? 'playing' : ((_b = (_a = streams[input.inputId]) === null || _a === void 0 ? void 0 : _a.videoState) !== null && _b !== void 0 ? _b : 'finished');
    const resolution = { width: 1920, height: 1080 };
    const inputComponent = ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: resolution, children: (0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { ...resolution, direction: 'column' }, children: [streamState === 'playing' ? (isImage ? ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fit' }, children: (0, jsx_runtime_1.jsx)(smelter_1.Image, { imageId: input.imageId }) })) : isTextInput ? ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: { width: 1920, height: 1080, backgroundColor: '#1a1a2e' }, children: (0, jsx_runtime_1.jsx)(ScrollingText, { text: input.text, maxLines: (_c = input.textMaxLines) !== null && _c !== void 0 ? _c : 10, scrollSpeed: (_d = input.textScrollSpeed) !== null && _d !== void 0 ? _d : 100, scrollLoop: (_e = input.textScrollLoop) !== null && _e !== void 0 ? _e : true, fontSize: 80, color: (_f = input.textColor) !== null && _f !== void 0 ? _f : 'white', align: (_g = input.textAlign) !== null && _g !== void 0 ? _g : 'left', containerWidth: resolution.width, containerHeight: resolution.height }) })) : ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fill' }, children: (0, jsx_runtime_1.jsx)(smelter_1.InputStream, { inputId: input.inputId, volume: input.volume }) }))) : streamState === 'ready' ? ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: { padding: 300 }, children: (0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fit' }, children: (0, jsx_runtime_1.jsx)(smelter_1.Image, { imageId: "spinner" }) }) })) : streamState === 'finished' ? ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: { padding: 300 }, children: (0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fit' }, children: (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: { fontSize: 600, fontFamily: 'Star Jedi' }, children: "Stream offline" }) }) })) : ((0, jsx_runtime_1.jsx)(smelter_1.View, {})), input.showTitle !== false && ((0, jsx_runtime_1.jsxs)(smelter_1.View, { style: {
                        backgroundColor: '#493880',
                        height: 90,
                        padding: 20,
                        borderRadius: 0,
                        direction: 'column',
                        overflow: 'visible',
                        bottom: 0,
                        left: 0,
                    }, children: [(0, jsx_runtime_1.jsx)(smelter_1.Text, { style: { fontSize: 40, color: 'white', fontFamily: 'Star Jedi' }, children: input === null || input === void 0 ? void 0 : input.title }), (0, jsx_runtime_1.jsx)(smelter_1.View, { style: { height: 10 } }), (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: { fontSize: 25, color: 'white', fontFamily: 'Star Jedi' }, children: input === null || input === void 0 ? void 0 : input.description })] }))] }) }));
    const activeShaders = input.shaders.filter(shader => shader.enabled);
    return wrapWithShaders(inputComponent, activeShaders, resolution);
}
function SmallInput({ input, resolution = { width: 640, height: 360 }, }) {
    var _a, _b, _c, _d, _e;
    const activeShaders = input.shaders.filter(shader => shader.enabled);
    const isImage = !!input.imageId;
    const isTextInput = !!input.text;
    const smallInputComponent = ((0, jsx_runtime_1.jsxs)(smelter_1.View, { style: {
            width: resolution.width,
            height: resolution.height,
            direction: 'column',
            overflow: 'visible',
        }, children: [isImage ? ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fit' }, children: (0, jsx_runtime_1.jsx)(smelter_1.Image, { imageId: input.imageId }) })) : isTextInput ? ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: { width: resolution.width, height: resolution.height, backgroundColor: '#1a1a2e' }, children: (0, jsx_runtime_1.jsx)(ScrollingText, { text: input.text, maxLines: (_a = input.textMaxLines) !== null && _a !== void 0 ? _a : 10, scrollSpeed: (_b = input.textScrollSpeed) !== null && _b !== void 0 ? _b : 100, scrollLoop: (_c = input.textScrollLoop) !== null && _c !== void 0 ? _c : true, fontSize: 30, color: (_d = input.textColor) !== null && _d !== void 0 ? _d : 'white', align: (_e = input.textAlign) !== null && _e !== void 0 ? _e : 'left', containerWidth: resolution.width, containerHeight: resolution.height }) })) : ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fill' }, children: (0, jsx_runtime_1.jsx)(smelter_1.InputStream, { inputId: input.inputId, volume: input.volume }) })), input.showTitle !== false && ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: {
                    backgroundColor: '#493880',
                    height: 40,
                    padding: 20,
                    borderRadius: 0,
                    direction: 'column',
                    overflow: 'visible',
                    bottom: 0,
                    left: 0,
                }, children: (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: { fontSize: 30, color: 'white', fontFamily: 'Star Jedi' }, children: input.title }) }))] }));
    if (activeShaders.length) {
        return ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { children: wrapWithShaders(smallInputComponent, activeShaders, resolution) }));
    }
    return (0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { children: smallInputComponent });
}
