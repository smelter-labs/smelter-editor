import { useEffect, useState } from "react";
import { Dimensions } from "react-native";

/**
 * Returns the physical screen dimensions (not the window/app dimensions).
 * Subscribes to Dimensions change events so it stays correct after rotation.
 */
export function useScreenDimensions() {
  const [dims, setDims] = useState(() => Dimensions.get("screen"));

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ screen }) => {
      setDims(screen);
    });
    return () => sub.remove();
  }, []);

  return dims;
}
