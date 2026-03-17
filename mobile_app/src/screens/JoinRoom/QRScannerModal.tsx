import React, { useEffect } from "react";
import { View, Modal, StyleSheet } from "react-native";
import { Button, Text, useTheme } from "react-native-paper";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ConnectionData } from "../../utils/connectionUtils";
import { appColors } from "../../theme/paperTheme";

interface QRScannerModalProps {
  isVisible: boolean;
  onScan: (data: ConnectionData) => void;
  onClose: () => void;
}

/**
 * Full-screen QR scanner modal using expo-camera.
 * Parses scanned data with ConnectionData.fromQRString().
 */
export function QRScannerModal({
  isVisible,
  onScan,
  onClose,
}: QRScannerModalProps) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    if (isVisible && !permission?.granted) {
      requestPermission();
    }
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <Modal visible={isVisible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {permission?.granted ? (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(result) => {
              const data = ConnectionData.fromQRString(result.data);
              if (data && data.isValid()) {
                onScan(data);
              }
            }}
          >
            <View style={styles.overlay}>
              <View
                style={[
                  styles.scanFrame,
                  { borderColor: theme.colors.primary },
                ]}
              />
              <Text variant="bodyMedium" style={styles.overlayText}>
                Point at a Smelter QR code to connect
              </Text>
            </View>
          </CameraView>
        ) : (
          <View style={styles.permissionContainer}>
            <Text
              variant="bodyMedium"
              style={{ color: appColors.muted, textAlign: "center" }}
            >
              Camera permission is required to scan QR codes.
            </Text>
            <Button mode="contained" onPress={requestPermission}>
              Grant Permission
            </Button>
          </View>
        )}

        <Button
          mode="contained-tonal"
          onPress={onClose}
          style={styles.cancelButton}
        >
          Cancel
        </Button>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
  },
  scanFrame: {
    width: 220,
    height: 220,
    borderWidth: 2,
    borderRadius: 12,
  },
  overlayText: {
    color: "#ffffff",
    textAlign: "center",
  },
  permissionContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 32,
  },
  cancelButton: {
    position: "absolute",
    top: 24,
    right: 24,
  },
});
