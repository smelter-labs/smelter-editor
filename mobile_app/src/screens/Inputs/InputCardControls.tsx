import React from "react";
import { Alert, View, StyleSheet } from "react-native";
import { Button, useTheme } from "react-native-paper";
import { useInputsStore } from "../../store/inputsStore";
import { useConnectionStore } from "../../store/connectionStore";
import { apiService } from "../../services/apiService";
import type { InputCard } from "../../types/input";
import { appColors } from "../../theme/paperTheme";

interface InputCardControlsProps {
  input: InputCard;
  onUpdate: (changes: Partial<InputCard>) => void;
}

/**
 * Action controls for a single input card:
 * Hide/Show, Mute, Audio Only, Remove (with optional confirmation).
 */
export function InputCardControls({ input, onUpdate }: InputCardControlsProps) {
  const theme = useTheme();
  const { confirmRemoval, removeInput } = useInputsStore();
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const roomId = useConnectionStore((state) => state.roomId);

  const handleHideShow = () => {
    const next = !input.isHidden;
    // Optimistic update
    onUpdate({ isHidden: next });
    const call = next
      ? apiService.hideInput(serverUrl, roomId, input.id)
      : apiService.showInput(serverUrl, roomId, input.id);
    call.catch((err) => {
      console.error("[InputCardControls] hide/show failed:", err);
      // Revert optimistic update on error
      onUpdate({ isHidden: !next });
    });
  };

  const doRemove = () => {
    apiService
      .removeInput(serverUrl, roomId, input.id)
      .then(() => {
        // The input_deleted WS event will clean up the store,
        // but we also remove locally for instant feedback.
        removeInput(input.id);
      })
      .catch((err) => {
        console.error("[InputCardControls] remove failed:", err);
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
      >
        {input.isHidden ? "Show" : "Hide"}
      </Button>

      <Button
        mode="contained-tonal"
        compact
        buttonColor={input.isMuted ? theme.colors.primary : appColors.slate}
        textColor="#ffffff"
        onPress={() => onUpdate({ isMuted: !input.isMuted })}
        style={styles.button}
        labelStyle={styles.label}
      >
        {input.isMuted ? "Unmute" : "Mute"}
      </Button>

      <Button
        mode="contained-tonal"
        compact
        buttonColor={input.isAudioOnly ? theme.colors.primary : appColors.slate}
        textColor="#ffffff"
        onPress={() => onUpdate({ isAudioOnly: !input.isAudioOnly })}
        style={styles.button}
        labelStyle={styles.label}
      >
        Audio Only
      </Button>

      <Button
        mode="contained-tonal"
        compact
        buttonColor={appColors.red}
        textColor="#ffffff"
        onPress={handleRemove}
        style={styles.button}
        labelStyle={styles.label}
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
