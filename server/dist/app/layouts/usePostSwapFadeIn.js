"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usePostSwapFadeIn = usePostSwapFadeIn;
const react_1 = require("react");
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
/**
 * Animates opacity for secondary content during swap transitions.
 *
 * - Default (no transition yet): opacity = 1
 * - When transition starts: animates 1→0 over `fadeOutDurationMs`
 * - When transition ends: animates 0→1 over `fadeInDurationMs`
 * - If both durations are <= 0, opacity is always 1.
 */
function usePostSwapFadeIn(isTransitioning, fadeInDurationMs, fadeOutDurationMs = 0) {
    const [fadeOpacity, setFadeOpacity] = (0, react_1.useState)(1);
    const wasTransitioningRef = (0, react_1.useRef)(false);
    const animRef = (0, react_1.useRef)(null);
    (0, react_1.useEffect)(() => {
        if (fadeInDurationMs <= 0 && fadeOutDurationMs <= 0) {
            setFadeOpacity(1);
            wasTransitioningRef.current = isTransitioning;
            return;
        }
        if (isTransitioning && !wasTransitioningRef.current) {
            // Transition just started — fade out
            wasTransitioningRef.current = true;
            if (animRef.current) {
                clearInterval(animRef.current);
                animRef.current = null;
            }
            if (fadeOutDurationMs <= 0) {
                setFadeOpacity(0);
                return;
            }
            const startTime = Date.now();
            setFadeOpacity(1);
            animRef.current = setInterval(() => {
                const elapsed = Date.now() - startTime;
                const rawT = Math.min(1, elapsed / fadeOutDurationMs);
                const easedT = easeInOutCubic(rawT);
                if (rawT >= 1) {
                    if (animRef.current) {
                        clearInterval(animRef.current);
                        animRef.current = null;
                    }
                    setFadeOpacity(0);
                }
                else {
                    setFadeOpacity(1 - easedT);
                }
            }, 16);
            return () => {
                if (animRef.current) {
                    clearInterval(animRef.current);
                    animRef.current = null;
                }
            };
        }
        if (isTransitioning) {
            // Still transitioning (after fade-out already started), keep current state
            return;
        }
        // isTransitioning is false
        if (!wasTransitioningRef.current) {
            // No transition occurred yet, keep default
            return;
        }
        // Transition just ended — fade in
        wasTransitioningRef.current = false;
        if (animRef.current) {
            clearInterval(animRef.current);
            animRef.current = null;
        }
        if (fadeInDurationMs <= 0) {
            setFadeOpacity(1);
            return;
        }
        const startTime = Date.now();
        setFadeOpacity(0);
        animRef.current = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const rawT = Math.min(1, elapsed / fadeInDurationMs);
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
    }, [isTransitioning, fadeInDurationMs, fadeOutDurationMs]);
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
