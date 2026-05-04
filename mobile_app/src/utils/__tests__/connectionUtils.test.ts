import { describe, it, expect } from "vitest";
import { ConnectionData } from "../connectionUtils";

// ── fromQRString ──────────────────────────────────────────────────────────────

describe("ConnectionData.fromQRString", () => {
  describe("JSON format", () => {
    it("parses a valid JSON payload", () => {
      const result = ConnectionData.fromQRString(
        JSON.stringify({ serverUrl: "http://192.168.1.1:3001", roomId: "my-room" }),
      );
      expect(result?.serverUrl).toBe("http://192.168.1.1:3001");
      expect(result?.roomId).toBe("my-room");
    });

    it("returns null when JSON is missing serverUrl", () => {
      expect(
        ConnectionData.fromQRString(JSON.stringify({ roomId: "r" })),
      ).toBeNull();
    });

    it("returns null when JSON is missing roomId", () => {
      expect(
        ConnectionData.fromQRString(
          JSON.stringify({ serverUrl: "http://host:3001" }),
        ),
      ).toBeNull();
    });

    it("returns null when fields are not strings", () => {
      expect(
        ConnectionData.fromQRString(
          JSON.stringify({ serverUrl: 123, roomId: 456 }),
        ),
      ).toBeNull();
    });

    it("trims leading/trailing whitespace before parsing", () => {
      const payload = `  ${JSON.stringify({ serverUrl: "http://h:3001", roomId: "r" })}  `;
      const result = ConnectionData.fromQRString(payload);
      expect(result?.serverUrl).toBe("http://h:3001");
      expect(result?.roomId).toBe("r");
    });
  });

  describe("URL query-param format", () => {
    it("parses serverUrl + roomId from query params", () => {
      const result = ConnectionData.fromQRString(
        "smelter://connect?serverUrl=http%3A%2F%2F10.0.0.1%3A3001&roomId=live",
      );
      expect(result?.serverUrl).toBe("http://10.0.0.1:3001");
      expect(result?.roomId).toBe("live");
    });

    it("returns null when roomId param is absent", () => {
      expect(
        ConnectionData.fromQRString(
          "https://host?serverUrl=http://h:3001",
        ),
      ).toBeNull();
    });

    it("returns null when serverUrl param is absent", () => {
      expect(
        ConnectionData.fromQRString("https://host?roomId=r"),
      ).toBeNull();
    });
  });

  describe("URL path format (wss://host/.../room/<roomId>)", () => {
    it("parses roomId from path with no base path", () => {
      const result = ConnectionData.fromQRString(
        "wss://192.168.1.10:3001/room/my-room",
      );
      expect(result?.serverUrl).toBe("wss://192.168.1.10:3001");
      expect(result?.roomId).toBe("my-room");
    });

    it("parses roomId from path with a base path prefix", () => {
      const result = ConnectionData.fromQRString(
        "https://example.com/api/v1/room/conference",
      );
      expect(result?.serverUrl).toBe("https://example.com/api/v1");
      expect(result?.roomId).toBe("conference");
    });

    it("decodes percent-encoded roomId", () => {
      const result = ConnectionData.fromQRString(
        "http://host:3001/room/my%20room",
      );
      expect(result?.roomId).toBe("my room");
    });

    it("returns null when /room/ segment is absent", () => {
      expect(
        ConnectionData.fromQRString("http://host:3001/api/v1"),
      ).toBeNull();
    });

    it("returns null when /room/ has no following segment", () => {
      expect(
        ConnectionData.fromQRString("http://host:3001/room/"),
      ).toBeNull();
    });
  });

  describe("invalid input", () => {
    it("returns null for a plain string", () => {
      expect(ConnectionData.fromQRString("not-a-url-or-json")).toBeNull();
    });

    it("returns null for an empty string", () => {
      expect(ConnectionData.fromQRString("")).toBeNull();
    });

    it("returns null for whitespace only", () => {
      expect(ConnectionData.fromQRString("   ")).toBeNull();
    });
  });
});

// ── fromManualInput ───────────────────────────────────────────────────────────

describe("ConnectionData.fromManualInput", () => {
  it("stores trimmed serverUrl and roomId", () => {
    const cd = ConnectionData.fromManualInput(
      "  http://host:3001  ",
      "  my-room  ",
    );
    expect(cd.serverUrl).toBe("http://host:3001");
    expect(cd.roomId).toBe("my-room");
  });

  it("stores empty strings as-is", () => {
    const cd = ConnectionData.fromManualInput("", "");
    expect(cd.serverUrl).toBe("");
    expect(cd.roomId).toBe("");
  });
});

// ── isValid ───────────────────────────────────────────────────────────────────

describe("ConnectionData.isValid", () => {
  it("accepts http URL with port and non-empty roomId", () => {
    expect(
      ConnectionData.fromManualInput("http://192.168.1.1:3001", "room").isValid(),
    ).toBe(true);
  });

  it("accepts https URL", () => {
    expect(
      ConnectionData.fromManualInput("https://example.com", "r").isValid(),
    ).toBe(true);
  });

  it("accepts ws URL", () => {
    expect(
      ConnectionData.fromManualInput("ws://192.168.0.5:3001", "r").isValid(),
    ).toBe(true);
  });

  it("accepts wss URL", () => {
    expect(
      ConnectionData.fromManualInput("wss://example.com", "r").isValid(),
    ).toBe(true);
  });

  it("accepts bare host:port (no scheme) by prepending http://", () => {
    expect(
      ConnectionData.fromManualInput("192.168.1.1:3001", "r").isValid(),
    ).toBe(true);
  });

  it("returns false when roomId is empty", () => {
    expect(
      ConnectionData.fromManualInput("http://host:3001", "").isValid(),
    ).toBe(false);
  });

  it("returns false when serverUrl is empty", () => {
    expect(
      ConnectionData.fromManualInput("", "room").isValid(),
    ).toBe(false);
  });

  it("returns false for a completely invalid URL", () => {
    expect(
      ConnectionData.fromManualInput("not a url", "room").isValid(),
    ).toBe(false);
  });

  it("returns false when both fields are empty", () => {
    expect(ConnectionData.fromManualInput("", "").isValid()).toBe(false);
  });
});
