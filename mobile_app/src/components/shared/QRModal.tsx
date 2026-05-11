import React from "react";
import {
  ImageSourcePropType,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { Modal, Portal, Surface, Text } from "react-native-paper";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { appColors } from "../../theme/paperTheme";

type QRModalProps = {
  visible: boolean;
  onDismiss: () => void;
  serverUrl?: string;
  roomId?: string;
};

const LOGO_SOURCE: ImageSourcePropType = require("../../../assets/icon.png");

export function QRModal({
  visible,
  onDismiss,
  serverUrl,
  roomId,
}: QRModalProps) {
  const insets = useSafeAreaInsets();
  const windowDimensions = useWindowDimensions();
  const qrSize =
    Math.min(windowDimensions.width, windowDimensions.height) * 0.6;
  const verticalCenterOffset = -Math.round((insets.top - insets.bottom) / 1.5); // Why 1.5 and not 2? Because we want to overcompensate slightly

  const qrValue =
    serverUrl && roomId
      ? `${serverUrl}/room/${encodeURIComponent(roomId)}`
      : "https://smelter.dev";

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        dismissable={true}
        dismissableBackButton={true}
        contentContainerStyle={[
          styles.modalContent,
          { marginTop: verticalCenterOffset },
        ]}
      >
        <Surface elevation={4} style={styles.container}>
          <Text variant="bodyLarge" style={styles.qrText}>
            Scan to join room
          </Text>
          <QRCode
            value={qrValue}
            size={qrSize}
            color={appColors.red}
            backgroundColor={appColors.blue}
            logo={LOGO_SOURCE}
            quietZone={10}
          />
        </Surface>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modalContent: {
    justifyContent: "center",
    alignSelf: "center",
    alignItems: "center",
  },
  container: {
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
  },
  qrText: {
    marginBottom: 16,
  },
});
