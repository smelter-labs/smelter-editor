import { useState, useEffect } from "react";
import DeviceInfo from "react-native-device-info";

export function useIsTablet(): boolean | null {
  const [isTablet, setIsTablet] = useState<boolean | null>(null);

  useEffect(() => {
    setIsTablet(DeviceInfo.isTablet());
  }, []);

  return isTablet;
}
