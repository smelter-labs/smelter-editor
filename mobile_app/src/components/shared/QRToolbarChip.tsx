import React, { useState } from "react";
import { QRModal } from "./QRModal";
import { ScreenToolbarChip, ToolbarIcon } from "./ScreenToolbar";

type QRToolbarChipProps = {
  serverUrl?: string;
  roomId?: string;
};

export function QRToolbarChip({ serverUrl, roomId }: QRToolbarChipProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <ScreenToolbarChip onPress={() => setIsOpen(true)}>
        <ToolbarIcon name="qrcode" />
      </ScreenToolbarChip>

      <QRModal
        visible={isOpen}
        onDismiss={() => setIsOpen(false)}
        serverUrl={serverUrl}
        roomId={roomId}
      />
    </>
  );
}
