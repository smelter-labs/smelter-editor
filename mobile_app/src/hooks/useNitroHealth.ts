import { useEffect } from "react";
import { Platform } from "react-native";
import { NitroModules } from "react-native-nitro-modules";

type NitroPathStatus = "native" | "fallback";

type NitroHealthState = {
  path: NitroPathStatus;
  reason: string;
};

let cachedNitroHealth: NitroHealthState | null = null;

function resolveNitroHealth(): NitroHealthState {
  if (cachedNitroHealth) return cachedNitroHealth;

  try {
    if (Platform.OS === "web") {
      cachedNitroHealth = { path: "fallback", reason: "web_platform" };
      return cachedNitroHealth;
    }

    const hybridObject = NitroModules.createHybridObject<any>("Reshuffle");
    cachedNitroHealth = hybridObject
      ? { path: "native", reason: "hybrid_object_available" }
      : { path: "fallback", reason: "hybrid_object_missing" };
    return cachedNitroHealth;
  } catch (error) {
    cachedNitroHealth = {
      path: "fallback",
      reason: error instanceof Error ? error.message : "nitro_probe_failed",
    };
    return cachedNitroHealth;
  }
}

const loggedScopes = new Set<string>();

const nitroHealth = resolveNitroHealth();

export function useNitroHealth(scope: string): NitroHealthState {
  const state = nitroHealth;

  useEffect(() => {
    if (__DEV__ && !loggedScopes.has(scope)) {
      loggedScopes.add(scope);
      console.info(`[NitroHealth:${scope}]`, state);
    }
  }, [scope, state]);

  return state;
}
