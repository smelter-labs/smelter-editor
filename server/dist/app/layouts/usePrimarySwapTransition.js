"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usePrimarySwapTransition = usePrimarySwapTransition;
const react_1 = require("react");
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
/**
 * Detects when the primary input (inputs[0]) changes and provides
 * animated transition state for swapping between Input and SmallInput.
 *
 * @param inputs - current inputs array from store
 * @param durationMs - transition duration in ms (default 500)
 */
function usePrimarySwapTransition(inputs, durationMs = 500) {
    var _a;
    const prevPrimaryRef = (0, react_1.useRef)(null);
    const prevInputsRef = (0, react_1.useRef)(inputs);
    const [state, setState] = (0, react_1.useState)({
        isTransitioning: false,
        incomingInput: null,
        outgoingInput: null,
        progress: 0,
        incomingPrevIndex: 0,
        prevSecondaryCount: 0,
    });
    const animRef = (0, react_1.useRef)(null);
    const currentPrimary = (_a = inputs[0]) !== null && _a !== void 0 ? _a : null;
    // Track whether we need to start an interval (set during render, consumed by effect)
    const needsAnimStartRef = (0, react_1.useRef)(false);
    // ── Synchronous detection during render ──
    // Detect primary change immediately so the outgoing overlay is present
    // on the very first frame — avoids a one-frame "blink".
    if (prevPrimaryRef.current &&
        currentPrimary &&
        prevPrimaryRef.current.inputId !== currentPrimary.inputId &&
        !state.isTransitioning &&
        durationMs > 0 &&
        inputs.some(i => i.inputId === prevPrimaryRef.current.inputId)) {
        const prevSecondary = prevInputsRef.current.filter(i => i.inputId !== prevPrimaryRef.current.inputId);
        const idx = prevSecondary.findIndex(i => i.inputId === currentPrimary.inputId);
        // setState during render: React discards current output and re-renders
        // immediately before painting, so the outgoing overlay is never missing.
        setState({
            isTransitioning: true,
            incomingInput: currentPrimary,
            outgoingInput: prevPrimaryRef.current,
            progress: 0,
            incomingPrevIndex: Math.max(0, idx),
            prevSecondaryCount: prevSecondary.length,
        });
        prevPrimaryRef.current = currentPrimary;
        prevInputsRef.current = inputs;
        needsAnimStartRef.current = true;
    }
    // ── Effect: start / manage the animation interval ──
    (0, react_1.useEffect)(() => {
        // First render or no previous primary — just record
        if (!prevPrimaryRef.current) {
            prevPrimaryRef.current = currentPrimary;
            prevInputsRef.current = inputs;
            return;
        }
        // Refs already updated during render if a swap was detected.
        // If not a swap render, keep refs in sync.
        if (!needsAnimStartRef.current) {
            prevInputsRef.current = inputs;
            if (currentPrimary) {
                prevPrimaryRef.current = currentPrimary;
            }
            return;
        }
        // A swap was detected during render — start the animation interval.
        needsAnimStartRef.current = false;
        if (animRef.current) {
            clearInterval(animRef.current);
        }
        const startTime = Date.now();
        const initState = state; // already set synchronously above
        animRef.current = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const rawT = Math.min(1, elapsed / durationMs);
            const easedT = easeInOutCubic(rawT);
            if (rawT >= 1) {
                if (animRef.current) {
                    clearInterval(animRef.current);
                    animRef.current = null;
                }
                setState({
                    isTransitioning: false,
                    incomingInput: null,
                    outgoingInput: null,
                    progress: 1,
                    incomingPrevIndex: 0,
                    prevSecondaryCount: 0,
                });
            }
            else {
                setState({
                    ...initState,
                    progress: easedT,
                });
            }
        }, 16);
        return () => {
            if (animRef.current) {
                clearInterval(animRef.current);
                animRef.current = null;
            }
        };
    }, [currentPrimary === null || currentPrimary === void 0 ? void 0 : currentPrimary.inputId, durationMs]);
    // Cleanup on unmount
    (0, react_1.useEffect)(() => {
        return () => {
            if (animRef.current) {
                clearInterval(animRef.current);
                animRef.current = null;
            }
        };
    }, []);
    return state;
}
