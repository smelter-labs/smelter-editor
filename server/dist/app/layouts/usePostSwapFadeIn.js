"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usePostSwapFadeIn = usePostSwapFadeIn;
const react_1 = require("react");
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
/**
 * Animates opacity from 0 to 1 after a swap transition completes.
 *
 * - While `isTransitioning` is true, fadeOpacity is 0.
 * - When `isTransitioning` transitions from true to false, fadeOpacity
 *   animates from 0 to 1 over `durationMs` milliseconds.
 * - When no transition has occurred yet, fadeOpacity is 1 (default).
 * - If `durationMs <= 0`, fadeOpacity is always 1.
 *
 * @param isTransitioning - whether a swap transition is currently in progress
 * @param durationMs - fade-in duration in ms (e.g. 500)
 */
function usePostSwapFadeIn(isTransitioning, durationMs) {
    const [fadeOpacity, setFadeOpacity] = (0, react_1.useState)(1);
    const wasTransitioningRef = (0, react_1.useRef)(false);
    const animRef = (0, react_1.useRef)(null);
    (0, react_1.useEffect)(() => {
        if (durationMs <= 0) {
            setFadeOpacity(1);
            wasTransitioningRef.current = isTransitioning;
            return;
        }
        if (isTransitioning) {
            // While transitioning, hold opacity at 0
            if (animRef.current) {
                clearInterval(animRef.current);
                animRef.current = null;
            }
            setFadeOpacity(0);
            wasTransitioningRef.current = true;
            return;
        }
        // isTransitioning is false
        if (!wasTransitioningRef.current) {
            // No transition occurred yet, keep default
            return;
        }
        // Transition just ended — start fade-in animation
        wasTransitioningRef.current = false;
        if (animRef.current) {
            clearInterval(animRef.current);
        }
        const startTime = Date.now();
        setFadeOpacity(0);
        animRef.current = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const rawT = Math.min(1, elapsed / durationMs);
            const easedT = easeInOutCubic(rawT);
            if (rawT >= 1) {
                if (animRef.current) {
                    clearInterval(animRef.current);
                    animRef.current = null;
                }
                setFadeOpacity(1);
            }
            else {
                setFadeOpacity(easedT);
            }
        }, 16);
        return () => {
            if (animRef.current) {
                clearInterval(animRef.current);
                animRef.current = null;
            }
        };
    }, [isTransitioning, durationMs]);
    // Cleanup on unmount
    (0, react_1.useEffect)(() => {
        return () => {
            if (animRef.current) {
                clearInterval(animRef.current);
                animRef.current = null;
            }
        };
    }, []);
    return fadeOpacity;
}
