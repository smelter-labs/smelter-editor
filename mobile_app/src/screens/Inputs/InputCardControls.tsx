import React, { useEffect, useState } from "react";
import { Alert, View, StyleSheet } from "react-native";
import { Button, useTheme } from "react-native-paper";
import { useInputsStore } from "../../store/inputsStore";
import { useConnectionStore } from "../../store/connectionStore";
import { apiService } from "../../services/apiService";
import type { InputCard } from "../../types/input";
import { appColors } from "../../theme/paperTheme";

interface InputCardControlsProps {
  input: InputCard;
}

/**
 * Action controls for a single input card:
 * Hide/Show, Remove (with optional confirmation).
 */
export function InputCardControls({ input }: InputCardControlsProps) {
  const theme = useTheme();
  const confirmRemoval = useInputsStore((state) => state.confirmRemoval);
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const roomId = useConnectionStore((state) => state.roomId);
  const [pendingChanges, setPendingChanges] = useState<Partial<
    Pick<InputCard, "isHidden">
  > | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    if (!pendingChanges) return;

    const matches = Object.entries(pendingChanges).every(([key, value]) => {
      return input[key as keyof InputCard] === value;
    });

    if (matches) {
      setPendingChanges(null);
    }
  }, [input, pendingChanges]);

  const isBusy = pendingChanges !== null || isRemoving;

  const updateInputState = async (
    changes: Partial<Pick<InputCard, "isHidden">>,
    action: () => Promise<void>,
  ) => {
    if (isBusy) return;
    setPendingChanges(changes);
    try {
      await action();
    } catch (err) {
      setPendingChanges(null);
      throw err;
    }
  };

  const handleHideShow = () => {
    const next = !input.isHidden;
    void updateInputState({ isHidden: next }, () =>
      next
        ? apiService.hideInput(serverUrl, roomId, input.id)
        : apiService.showInput(serverUrl, roomId, input.id),
    ).catch((err) => {
      console.error("[InputCardControls] hide/show failed:", err);
    });
  };

  const doRemove = () => {
    if (isRemoving) return;
    setIsRemoving(true);
    apiService.removeInput(serverUrl, roomId, input.id).catch((err) => {
      console.error("[InputCardControls] remove failed:", err);
      setIsRemoving(false);
    });
  };

  const handleRemove = () => {
    if (confirmRemoval) {
      Alert.alert("Remove Input", `Remove "${input.name}"?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: doRemove },
      ]);
    } else {
      doRemove();
    }
  };

  return (
    <View style={styles.container}>
      <Button
        mode="contained-tonal"
        compact
        buttonColor={input.isHidden ? appColors.slate : theme.colors.primary}
        textColor="#ffffff"
        onPress={handleHideShow}
        style={styles.button}
        labelStyle={styles.label}
        disabled={isBusy}
        loading={pendingChanges?.isHidden !== undefined}
      >
        {input.isHidden ? "Show" : "Hide"}
      </Button>

      <Button
        mode="contained-tonal"
        compact
        buttonColor={appColors.red}
        textColor="#ffffff"
        onPress={handleRemove}
        style={styles.button}
        labelStyle={styles.label}
        disabled={isBusy || isRemoving}
        loading={isRemoving}
      >
        Remove
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  button: {
    borderRadius: 6,
  },
  label: {
    fontSize: 12,
    marginVertical: 2,
    marginHorizontal: 4,
  },
});
