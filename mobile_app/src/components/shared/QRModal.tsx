import React from "react";
import { ImageSourcePropType, StyleSheet } from "react-native";
import { Modal, Portal, Surface, Text } from "react-native-paper";
import QRCode from "react-native-qrcode-svg";
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
        contentContainerStyle={styles.modalContent}
      >
        <Surface elevation={4} style={styles.container}>
          <Text variant="displaySmall" style={styles.qrText}>
            Scan to join room
          </Text>
          <QRCode
            value={qrValue}
            size={250}
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
