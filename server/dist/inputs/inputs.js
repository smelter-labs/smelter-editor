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
function ScrollingText({ text, maxLines, scrollSpeed, scrollLoop, fontSize, color, align, containerWidth, containerHeight, scrollNudge = 0, }) {
    const lineHeight = fontSize * 1.2;
    const visibleHeight = containerHeight;
    const lines = text.split('\n');
    const totalTextHeight = lines.length * lineHeight;
    const shouldAnimate = maxLines > 0;
    const startPosition = visibleHeight;
    const [scrollOffset, setScrollOffset] = (0, react_1.useState)(startPosition);
    const [permanentNudgeOffset, setPermanentNudgeOffset] = (0, react_1.useState)(0);
    const permanentNudgeRef = (0, react_1.useRef)(0);
    const [animatingNudge, setAnimatingNudge] = (0, react_1.useState)(0);
    const timerRef = (0, react_1.useRef)(null);
    const nudgeTimerRef = (0, react_1.useRef)(null);
    const prevLinesCountRef = (0, react_1.useRef)(0);
    const initializedRef = (0, react_1.useRef)(false);
    const prevNudgeRef = (0, react_1.useRef)(0);
    (0, react_1.useEffect)(() => {
        if (scrollNudge !== 0 && scrollNudge !== prevNudgeRef.current) {
            prevNudgeRef.current = scrollNudge;
            const nudgeAmount = Math.floor(scrollNudge) * lineHeight;
            const nudgeDuration = 500;
            const intervalMs = 16;
            const steps = nudgeDuration / intervalMs;
            let currentStep = 0;
            if (nudgeTimerRef.current) {
                clearInterval(nudgeTimerRef.current);
            }
            nudgeTimerRef.current = setInterval(() => {
                currentStep++;
                const progress = currentStep / steps;
                const eased = progress < 0.5
                    ? 4 * progress * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
                setAnimatingNudge(nudgeAmount * eased);
                if (currentStep >= steps) {
                    if (nudgeTimerRef.current) {
                        clearInterval(nudgeTimerRef.current);
                        nudgeTimerRef.current = null;
                    }
                    permanentNudgeRef.current += nudgeAmount;
                    setPermanentNudgeOffset(permanentNudgeRef.current);
                    setAnimatingNudge(0);
                }
            }, intervalMs);
        }
    }, [scrollNudge, lineHeight]);
    (0, react_1.useEffect)(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (!shouldAnimate) {
            setScrollOffset(0);
            return;
        }
        const currentLinesCount = lines.length;
        const prevLinesCount = prevLinesCountRef.current;
        const isFirstRun = !initializedRef.current;
        prevLinesCountRef.current = currentLinesCount;
        initializedRef.current = true;
        if (isFirstRun) {
            setScrollOffset(startPosition);
        }
        const targetPosition = -totalTextHeight;
        const intervalMs = 16;
        const pixelsPerFrame = (scrollSpeed / 1000) * intervalMs;
        timerRef.current = setInterval(() => {
            setScrollOffset(prev => {
                const effectivePosition = prev + permanentNudgeRef.current;
                if (effectivePosition <= targetPosition) {
                    if (scrollLoop) {
                        permanentNudgeRef.current = 0;
                        setPermanentNudgeOffset(0);
                        return startPosition;
                    }
                    if (timerRef.current) {
                        clearInterval(timerRef.current);
                        timerRef.current = null;
                    }
                    return targetPosition - permanentNudgeRef.current;
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
    }, [text, shouldAnimate, totalTextHeight, startPosition, scrollSpeed, scrollLoop, lines.length]);
    const textTopOffset = shouldAnimate ? scrollOffset + permanentNudgeOffset + animatingNudge : 0;
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
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const streams = (0, smelter_1.useInputStreams)();
    const isImage = !!input.imageId;
    const isTextInput = !!input.text;
    const streamState = isImage || isTextInput ? 'playing' : ((_b = (_a = streams[input.inputId]) === null || _a === void 0 ? void 0 : _a.videoState) !== null && _b !== void 0 ? _b : 'finished');
    const isVerticalInput = input.orientation === 'vertical';
    const resolution = isVerticalInput ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
    const inputComponent = ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: resolution, children: (0, jsx_runtime_1.jsxs)(smelter_1.View, { style: { ...resolution, direction: 'column' }, children: [streamState === 'playing' ? (isImage ? ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fit' }, children: (0, jsx_runtime_1.jsx)(smelter_1.Image, { imageId: input.imageId }) })) : isTextInput ? ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: { width: resolution.width - 16, height: resolution.height - 16, backgroundColor: '#1a1a2e', borderWidth: 8, borderColor: '#ff0000' }, children: (0, jsx_runtime_1.jsx)(ScrollingText, { text: input.text, maxLines: (_c = input.textMaxLines) !== null && _c !== void 0 ? _c : 10, scrollSpeed: (_d = input.textScrollSpeed) !== null && _d !== void 0 ? _d : 40, scrollLoop: (_e = input.textScrollLoop) !== null && _e !== void 0 ? _e : true, fontSize: (_f = input.textFontSize) !== null && _f !== void 0 ? _f : 80, color: (_g = input.textColor) !== null && _g !== void 0 ? _g : 'white', align: (_h = input.textAlign) !== null && _h !== void 0 ? _h : 'left', containerWidth: resolution.width - 16, containerHeight: resolution.height - 16, scrollNudge: input.textScrollNudge }) })) : ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fill' }, children: (0, jsx_runtime_1.jsx)(smelter_1.InputStream, { inputId: input.inputId, volume: input.volume }) }))) : streamState === 'ready' ? ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: { padding: 300 }, children: (0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fit' }, children: (0, jsx_runtime_1.jsx)(smelter_1.Image, { imageId: "spinner" }) }) })) : streamState === 'finished' ? ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: { padding: 300 }, children: (0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fit' }, children: (0, jsx_runtime_1.jsx)(smelter_1.Text, { style: { fontSize: 600, fontFamily: 'Star Jedi' }, children: "Stream offline" }) }) })) : ((0, jsx_runtime_1.jsx)(smelter_1.View, {})), input.showTitle !== false && ((0, jsx_runtime_1.jsxs)(smelter_1.View, { style: {
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
        }, children: [isImage ? ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fit' }, children: (0, jsx_runtime_1.jsx)(smelter_1.Image, { imageId: input.imageId }) })) : isTextInput ? ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: { width: resolution.width - 8, height: resolution.height - 8, backgroundColor: '#1a1a2e', borderWidth: 4, borderColor: '#ff0000' }, children: (0, jsx_runtime_1.jsx)(ScrollingText, { text: input.text, maxLines: (_a = input.textMaxLines) !== null && _a !== void 0 ? _a : 10, scrollSpeed: (_b = input.textScrollSpeed) !== null && _b !== void 0 ? _b : 40, scrollLoop: (_c = input.textScrollLoop) !== null && _c !== void 0 ? _c : true, fontSize: 30, color: (_d = input.textColor) !== null && _d !== void 0 ? _d : 'white', align: (_e = input.textAlign) !== null && _e !== void 0 ? _e : 'left', containerWidth: resolution.width - 8, containerHeight: resolution.height - 8, scrollNudge: input.textScrollNudge }) })) : ((0, jsx_runtime_1.jsx)(smelter_1.Rescaler, { style: { rescaleMode: 'fill' }, children: (0, jsx_runtime_1.jsx)(smelter_1.InputStream, { inputId: input.inputId, volume: input.volume }) })), input.showTitle !== false && ((0, jsx_runtime_1.jsx)(smelter_1.View, { style: {
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
