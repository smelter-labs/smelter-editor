import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  ActivityIndicator,
  Button,
  Divider,
  IconButton,
  Switch,
  Text,
  TextInput,
} from "react-native-paper";
import type {
  ShaderConfig,
  ShaderParamDefinition,
} from "@smelter-editor/types";
import { SidePanel } from "../../components/shared/SidePanel";
import { useConnectionStore } from "../../store/connectionStore";
import { useInputsStore } from "../../store/inputsStore";
import { apiService, type AvailableShader } from "../../services/apiService";

interface LayoutEffectsPanelProps {
  isVisible: boolean;
  inputId: string | null;
  onClose: () => void;
}

function toShaderConfig(def: AvailableShader): ShaderConfig {
  const params = (def.params ?? []).map((param) => ({
    paramName: param.name,
    paramValue: param.defaultValue,
  }));
  return {
    shaderName: def.name,
    shaderId: def.id,
    enabled: true,
    params,
  };
}

function coerceParamValue(
  definition: ShaderParamDefinition | undefined,
  raw: string,
): number | string {
  if (definition?.type === "number") {
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      return definition.defaultValue;
    }
    return parsed;
  }
  return raw;
}

export function LayoutEffectsPanel({
  isVisible,
  inputId,
  onClose,
}: LayoutEffectsPanelProps) {
  const { serverUrl, roomId } = useConnectionStore();
  const { inputs, updateInput } = useInputsStore((s) => ({
    inputs: s.inputs,
    updateInput: s.updateInput,
  }));
  const input = useMemo(
    () => inputs.find((i) => i.id === inputId),
    [inputs, inputId],
  );

  const [availableShaders, setAvailableShaders] = useState<AvailableShader[]>(
    [],
  );
  const [loadingShaders, setLoadingShaders] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    setLoadingShaders(true);
    apiService
      .getAvailableShaders(serverUrl)
      .then((shaders) => {
        if (cancelled) return;
        setAvailableShaders(shaders);
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("[LayoutEffectsPanel] Failed to fetch shaders:", err);
          setAvailableShaders([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingShaders(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isVisible, serverUrl]);

  const saveShaders = useCallback(
    async (nextShaders: ShaderConfig[]) => {
      if (!inputId) return;
      setSaving(true);
      try {
        updateInput(inputId, { shaders: nextShaders });
        await apiService.updateInput(serverUrl, roomId, inputId, {
          shaders: nextShaders,
        });
      } catch (err) {
        console.error("[LayoutEffectsPanel] Failed to update shaders:", err);
      } finally {
        setSaving(false);
      }
    },
    [inputId, roomId, serverUrl, updateInput],
  );

  const activeShaders = input?.shaders ?? [];
  const activeShaderIds = new Set(
    activeShaders.map((shader) => shader.shaderId),
  );
  const addableShaders = availableShaders.filter(
    (s) => !activeShaderIds.has(s.id),
  );

  return (
    <SidePanel isVisible={isVisible} side="right" width={340} onClose={onClose}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text variant="titleMedium">Effects</Text>
          {saving && <ActivityIndicator size="small" />}
        </View>
        <Text variant="bodySmall" style={styles.subtleText}>
          {input ? `${input.name} (${input.id})` : "No input selected"}
        </Text>

        <Divider style={styles.divider} />

        {loadingShaders ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" />
            <Text variant="bodySmall" style={styles.subtleText}>
              Loading effects…
            </Text>
          </View>
        ) : (
          <>
            <Text variant="labelSmall" style={styles.sectionTitle}>
              Add effect
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.addRow}
            >
              {addableShaders.map((shader) => (
                <Button
                  key={shader.id}
                  mode="contained-tonal"
                  compact
                  onPress={() => {
                    void saveShaders([
                      ...activeShaders,
                      toShaderConfig(shader),
                    ]);
                  }}
                >
                  + {shader.name}
                </Button>
              ))}
              {addableShaders.length === 0 && (
                <Text variant="bodySmall" style={styles.subtleText}>
                  All available effects are already added.
                </Text>
              )}
            </ScrollView>

            <Divider style={styles.divider} />

            <ScrollView
              style={styles.effectsList}
              contentContainerStyle={styles.effectsContent}
            >
              {activeShaders.length === 0 ? (
                <Text variant="bodyMedium" style={styles.subtleText}>
                  No effects configured.
                </Text>
              ) : (
                activeShaders.map((shader) => {
                  const shaderDef = availableShaders.find(
                    (s) => s.id === shader.shaderId,
                  );
                  return (
                    <View key={shader.shaderId} style={styles.effectCard}>
                      <View style={styles.effectHeader}>
                        <Text variant="titleSmall" style={styles.effectTitle}>
                          {shader.shaderName}
                        </Text>
                        <View style={styles.effectActions}>
                          <Switch
                            value={shader.enabled}
                            onValueChange={(enabled) => {
                              const nextShaders = activeShaders.map((s) =>
                                s.shaderId === shader.shaderId
                                  ? { ...s, enabled }
                                  : s,
                              );
                              void saveShaders(nextShaders);
                            }}
                          />
                          <IconButton
                            icon="delete-outline"
                            size={18}
                            onPress={() => {
                              const nextShaders = activeShaders.filter(
                                (s) => s.shaderId !== shader.shaderId,
                              );
                              void saveShaders(nextShaders);
                            }}
                          />
                        </View>
                      </View>

                      {(shader.params ?? []).map((param) => {
                        const definition = shaderDef?.params?.find(
                          (p) => p.name === param.paramName,
                        );
                        return (
                          <View
                            key={`${shader.shaderId}:${param.paramName}`}
                            style={styles.paramRow}
                          >
                            <Text variant="bodySmall" style={styles.paramName}>
                              {param.paramName}
                            </Text>
                            <TextInput
                              mode="outlined"
                              dense
                              value={String(param.paramValue)}
                              onChangeText={(raw) => {
                                const value = coerceParamValue(definition, raw);
                                const nextShaders = activeShaders.map((s) => {
                                  if (s.shaderId !== shader.shaderId) return s;
                                  return {
                                    ...s,
                                    params: s.params.map((p) =>
                                      p.paramName === param.paramName
                                        ? { ...p, paramValue: value }
                                        : p,
                                    ),
                                  };
                                });
                                void saveShaders(nextShaders);
                              }}
                              keyboardType={
                                definition?.type === "number"
                                  ? "decimal-pad"
                                  : "default"
                              }
                              style={styles.paramInput}
                            />
                          </View>
                        );
                      })}
                    </View>
                  );
                })
              )}
            </ScrollView>
          </>
        )}
      </View>
    </SidePanel>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  subtleText: {
    opacity: 0.7,
  },
  divider: {
    marginVertical: 12,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  addRow: {
    gap: 8,
    alignItems: "center",
    paddingRight: 8,
  },
  effectsList: {
    flex: 1,
  },
  effectsContent: {
    gap: 10,
    paddingBottom: 20,
  },
  effectCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  effectHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  effectActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  effectTitle: {
    flex: 1,
    marginRight: 8,
  },
  paramRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  paramName: {
    width: 110,
  },
  paramInput: {
    flex: 1,
    height: 40,
  },
});
