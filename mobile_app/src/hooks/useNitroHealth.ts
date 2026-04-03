import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { NitroModules } from "react-native-nitro-modules";

type NitroPathStatus = "native" | "fallback";

type NitroHealthState = {
  path: NitroPathStatus;
  reason: string;
};

export function useNitroHealth(scope: string): NitroHealthState {
  const [state, setState] = useState<NitroHealthState>({
    path: "fallback",
    reason: "not_checked",
  });

  useEffect(() => {
    try {
      if (Platform.OS === "web") {
        setState({ path: "fallback", reason: "web_platform" });
        return;
      }

      const hybridObject = NitroModules.createHybridObject<any>("Reshuffle");
      if (hybridObject) {
        setState({ path: "native", reason: "hybrid_object_available" });
      } else {
        setState({ path: "fallback", reason: "hybrid_object_missing" });
      }
    } catch (error) {
      setState({
        path: "fallback",
        reason: error instanceof Error ? error.message : "nitro_probe_failed",
      });
    }
  }, []);

  useEffect(() => {
    console.info(`[NitroHealth:${scope}]`, state);
  }, [scope, state]);

  return state;
}
