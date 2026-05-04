import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useJoinRoom } from "../useJoinRoom";
import { SCREEN_NAMES } from "../../../navigation/navigationTypes";
import { ConnectionData } from "../../../utils/connectionUtils";

// ── Navigation mock — one stable object so tests can spy on the same instance ──

const mockNavigation = {
  navigate: vi.fn(),
  replace: vi.fn(),
  goBack: vi.fn(),
};

vi.mock("@react-navigation/native", () => ({
  useNavigation: vi.fn(() => mockNavigation),
}));

// ── Service mocks ─────────────────────────────────────────────────────────────

vi.mock("../../../services/apiService", () => ({
  apiService: {
    fetchActiveRooms: vi.fn(),
    fetchRoomState: vi.fn(),
    mapInputsToCards: vi.fn((inputs) => inputs ?? []),
  },
}));

vi.mock("../../../services/websocketService", () => ({
  wsService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

// ── Store mocks (minimal — only what useJoinRoom actually reads/writes) ────────

vi.mock("../../../store/connectionStore", () => {
  const state = {
    serverUrl: "",
    setCredentials: vi.fn(),
    setError: vi.fn(),
    setStatus: vi.fn(),
  };
  return {
    useConnectionStore: Object.assign(
      vi.fn(() => state),
      {
        getState: () => ({ setTimelinePlaying: vi.fn(), ...state }),
      },
    ),
  };
});

vi.mock("../../../store/inputsStore", () => ({
  useInputsStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: () => ({ setInputs: vi.fn() }),
    },
  ),
}));

vi.mock("../../../store/layoutStore", () => ({
  useLayoutStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: () => ({
        setLayers: vi.fn(),
        setResolution: vi.fn(),
        setGridConfig: vi.fn(),
      }),
    },
  ),
}));

vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: () => ({ gridFactor: 50 }),
    },
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { apiService } from "../../../services/apiService";
import { wsService } from "../../../services/websocketService";

const mockFetchActiveRooms = apiService.fetchActiveRooms as ReturnType<
  typeof vi.fn
>;
const mockFetchRoomState = apiService.fetchRoomState as ReturnType<
  typeof vi.fn
>;
const mockWsConnect = wsService.connect as ReturnType<typeof vi.fn>;

const ROOMS = [
  { roomId: "room-a", roomName: "Room A" },
  { roomId: "room-b", roomName: "Room B" },
];

const ROOM_STATE = {
  inputs: [],
  layers: [{ id: "layer-1", inputs: [] }],
  resolution: { width: 1920, height: 1080 },
  isTimelinePlaying: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Restore navigation mock after vi.clearAllMocks() clears return values
  (mockNavigation.navigate as ReturnType<typeof vi.fn>).mockReset();
  (mockNavigation.replace as ReturnType<typeof vi.fn>).mockReset();
  // Reset AsyncStorage between tests via the in-memory store in setup.ts
  void (AsyncStorage as any).clear();
  mockFetchActiveRooms.mockResolvedValue(ROOMS);
  mockFetchRoomState.mockResolvedValue(ROOM_STATE);
  mockWsConnect.mockResolvedValue(undefined);
});

// ── Phase management ──────────────────────────────────────────────────────────

describe("phase", () => {
  it("starts in the server phase", async () => {
    const { result } = renderHook(() => useJoinRoom());
    // Drain the mount-time async AsyncStorage load so its setSavedUrls call
    // happens inside act() and doesn't warn after this test ends.
    await act(async () => {});
    expect(result.current.phase).toBe("server");
  });

  it("advances to room phase after a successful handleJoinServer", async () => {
    const { result } = renderHook(() => useJoinRoom());

    await act(async () => {
      await result.current.handleServerUrlChange("http://192.168.1.1:3001");
    });
    await act(async () => {
      await result.current.handleJoinServer("http://192.168.1.1:3001");
    });

    expect(result.current.phase).toBe("room");
    expect(result.current.rooms).toEqual(ROOMS);
  });

  it("resets to server phase when handleServerUrlChange is called again", async () => {
    const { result } = renderHook(() => useJoinRoom());

    await act(async () => {
      await result.current.handleJoinServer("http://192.168.1.1:3001");
    });
    expect(result.current.phase).toBe("room");

    act(() => {
      result.current.handleServerUrlChange("http://192.168.1.2:3001");
    });

    expect(result.current.phase).toBe("server");
    expect(result.current.rooms).toEqual([]);
  });
});

// ── handleJoinServer ──────────────────────────────────────────────────────────

describe("handleJoinServer", () => {
  it("sets serverStatus to loading then success", async () => {
    const { result } = renderHook(() => useJoinRoom());

    await act(async () => {
      await result.current.handleJoinServer("http://192.168.1.1:3001");
    });

    expect(result.current.serverStatus).toBe("success");
    expect(result.current.serverError).toBeNull();
  });

  it("rejects an empty URL", async () => {
    const { result } = renderHook(() => useJoinRoom());

    await act(async () => {
      await result.current.handleJoinServer("");
    });

    expect(result.current.serverStatus).toBe("error");
    expect(result.current.serverError).toBeTruthy();
    expect(mockFetchActiveRooms).not.toHaveBeenCalled();
  });

  it("rejects a malformed URL", async () => {
    const { result } = renderHook(() => useJoinRoom());

    await act(async () => {
      await result.current.handleJoinServer("not a url at all!!!");
    });

    expect(result.current.serverStatus).toBe("error");
    expect(mockFetchActiveRooms).not.toHaveBeenCalled();
  });

  it("sets serverStatus to error when fetch throws", async () => {
    mockFetchActiveRooms.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const { result } = renderHook(() => useJoinRoom());

    await act(async () => {
      await result.current.handleJoinServer("http://unreachable:3001");
    });

    expect(result.current.serverStatus).toBe("error");
    expect(result.current.serverError).toContain("ECONNREFUSED");
  });

  it("deduplicates rooms with the same roomId", async () => {
    mockFetchActiveRooms.mockResolvedValueOnce([
      { roomId: "dup", roomName: "First" },
      { roomId: "dup", roomName: "Second" },
      { roomId: "other", roomName: "Other" },
    ]);

    const { result } = renderHook(() => useJoinRoom());

    await act(async () => {
      await result.current.handleJoinServer("http://host:3001");
    });

    expect(result.current.rooms).toHaveLength(2);
    expect(result.current.rooms[0].roomId).toBe("dup");
    expect(result.current.rooms[1].roomId).toBe("other");
  });

  it("auto-saves a new URL to the saved list after success", async () => {
    const { result } = renderHook(() => useJoinRoom());
    // Wait for the initial AsyncStorage load to settle before calling handleJoinServer,
    // otherwise the async effect can overwrite the state set by handleJoinServer.
    await waitFor(() => expect(result.current.savedUrls).toEqual([]));

    await act(async () => {
      await result.current.handleJoinServer("http://new-server:3001");
    });

    expect(result.current.savedUrls).toContain("http://new-server:3001");
  });

  it("does not duplicate an already-saved URL", async () => {
    const { result } = renderHook(() => useJoinRoom());

    await act(async () => {
      await result.current.handleJoinServer("http://host:3001");
    });
    await act(async () => {
      await result.current.handleJoinServer("http://host:3001");
    });

    const count = result.current.savedUrls.filter(
      (u) => u === "http://host:3001",
    ).length;
    expect(count).toBe(1);
  });

  it("discards stale results when a newer call wins the race", async () => {
    // Slow first call, fast second call
    mockFetchActiveRooms
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve([{ roomId: "stale", roomName: "Stale" }]),
              200,
            ),
          ),
      )
      .mockResolvedValueOnce([{ roomId: "fresh", roomName: "Fresh" }]);

    const { result } = renderHook(() => useJoinRoom());

    act(() => {
      void result.current.handleJoinServer("http://slow:3001");
    });
    await act(async () => {
      result.current.handleServerUrlChange("http://fast:3001");
      await result.current.handleJoinServer("http://fast:3001");
    });

    expect(result.current.rooms.map((r) => r.roomId)).not.toContain("stale");
    expect(result.current.rooms[0]?.roomId).toBe("fresh");
  });
});

// ── URL history (savedUrls / removeSavedUrl) ──────────────────────────────────

describe("saved URL history", () => {
  it("loads saved URLs from AsyncStorage on mount", async () => {
    await AsyncStorage.setItem(
      "saved-server-urls",
      JSON.stringify(["http://persisted:3001"]),
    );

    const { result } = renderHook(() => useJoinRoom());

    await waitFor(() =>
      expect(result.current.savedUrls).toContain("http://persisted:3001"),
    );
  });

  it("removeSavedUrl drops the URL from the list and persists", async () => {
    const { result } = renderHook(() => useJoinRoom());

    await act(async () => {
      await result.current.handleJoinServer("http://to-remove:3001");
    });

    act(() => {
      result.current.removeSavedUrl("http://to-remove:3001");
    });

    expect(result.current.savedUrls).not.toContain("http://to-remove:3001");
    const raw = await AsyncStorage.getItem("saved-server-urls");
    const stored: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    expect(stored).not.toContain("http://to-remove:3001");
  });

  it("removeSavedUrl is a no-op for an unknown URL", async () => {
    const { result } = renderHook(() => useJoinRoom());
    await act(async () => {}); // drain mount-time AsyncStorage load
    const before = result.current.savedUrls.length;
    act(() => {
      result.current.removeSavedUrl("http://unknown:9999");
    });
    expect(result.current.savedUrls).toHaveLength(before);
  });

  it("handles corrupt AsyncStorage data gracefully", async () => {
    await AsyncStorage.setItem("saved-server-urls", "not-valid-json{{");

    const { result } = renderHook(() => useJoinRoom());

    await waitFor(() => {
      // Should fall back to empty list, not throw
      expect(result.current.savedUrls).toEqual([]);
    });
  });
});

// ── Health check ──────────────────────────────────────────────────────────────

describe("health checks", () => {
  it("marks a URL healthy after fetchActiveRooms succeeds", async () => {
    await AsyncStorage.setItem(
      "saved-server-urls",
      JSON.stringify(["http://healthy:3001"]),
    );

    const { result } = renderHook(() => useJoinRoom());

    await waitFor(() =>
      expect(result.current.healthStatus["http://healthy:3001"]).toBe("ok"),
    );
  });

  it("marks a URL unhealthy when fetchActiveRooms rejects", async () => {
    mockFetchActiveRooms.mockRejectedValue(new Error("timeout"));

    await AsyncStorage.setItem(
      "saved-server-urls",
      JSON.stringify(["http://dead:3001"]),
    );

    const { result } = renderHook(() => useJoinRoom());

    await waitFor(() =>
      expect(result.current.healthStatus["http://dead:3001"]).toBe("error"),
    );
  });
});

// ── handleConnect ─────────────────────────────────────────────────────────────

describe("handleConnect", () => {
  async function setupRoomPhase() {
    const hook = renderHook(() => useJoinRoom());
    // Set selectedServerUrl first so handleConnect can read it from state.
    // handleJoinServer(override) bypasses selectedServerUrl for the fetch but
    // doesn't update it, so we must call handleServerUrlChange explicitly.
    await act(async () => {
      hook.result.current.handleServerUrlChange("http://192.168.1.1:3001");
      await hook.result.current.handleJoinServer("http://192.168.1.1:3001");
    });
    return hook;
  }

  it("requires a roomId — sets errors.roomId when absent", async () => {
    const { result } = await setupRoomPhase();

    await act(async () => {
      await result.current.handleConnect();
    });

    expect(result.current.errors.roomId).toBeTruthy();
    expect(mockFetchRoomState).not.toHaveBeenCalled();
  });

  it("navigates to Main on success", async () => {
    const { result } = await setupRoomPhase();
    const nav = mockNavigation;

    act(() => {
      result.current.setSelectedRoomId("room-a");
    });
    await act(async () => {
      await result.current.handleConnect();
    });

    expect(mockFetchRoomState).toHaveBeenCalledWith(
      "http://192.168.1.1:3001",
      "room-a",
    );
    expect(mockWsConnect).toHaveBeenCalledWith(
      "http://192.168.1.1:3001",
      "room-a",
    );
    expect(nav.replace).toHaveBeenCalledWith(SCREEN_NAMES.MAIN);
    expect(result.current.errors).toEqual({});
  });

  it("uses privateRoomId when isPrivateRoom is toggled on", async () => {
    const { result } = await setupRoomPhase();

    act(() => {
      result.current.setSelectedRoomId("room-a");
      result.current.togglePrivateRoom();
      result.current.setPrivateRoomId("secret-room");
    });
    await act(async () => {
      await result.current.handleConnect();
    });

    expect(mockFetchRoomState).toHaveBeenCalledWith(
      expect.any(String),
      "secret-room",
    );
  });

  it("sets a friendly error for 404 responses", async () => {
    mockFetchRoomState.mockRejectedValueOnce(new Error("Room not found (404)"));
    const { result } = await setupRoomPhase();

    act(() => {
      result.current.setSelectedRoomId("ghost-room");
    });
    await act(async () => {
      await result.current.handleConnect();
    });

    expect(result.current.errors.roomId).toMatch(/room not found/i);
    expect(result.current.errors.general).toBeUndefined();
  });

  it("sets general error for non-404 failures", async () => {
    mockFetchRoomState.mockRejectedValueOnce(new Error("Network error"));
    const { result } = await setupRoomPhase();

    act(() => {
      result.current.setSelectedRoomId("room-a");
    });
    await act(async () => {
      await result.current.handleConnect();
    });

    expect(result.current.errors.general).toMatch(/network error/i);
    expect(result.current.errors.roomId).toBeUndefined();
  });

  it("clears isLoading after failure", async () => {
    mockFetchRoomState.mockRejectedValueOnce(new Error("fail"));
    const { result } = await setupRoomPhase();

    act(() => {
      result.current.setSelectedRoomId("room-a");
    });
    await act(async () => {
      await result.current.handleConnect();
    });

    expect(result.current.isLoading).toBe(false);
  });
});

// ── handleConnectAsCamera ─────────────────────────────────────────────────────

describe("handleConnectAsCamera", () => {
  it("requires a roomId", async () => {
    const { result } = renderHook(() => useJoinRoom());
    await act(async () => {}); // drain mount-time AsyncStorage load
    act(() => {
      result.current.handleConnectAsCamera();
    });
    expect(result.current.errors.roomId).toBeTruthy();
  });

  it("navigates to Camera screen with server + room", async () => {
    const { result } = renderHook(() => useJoinRoom());

    // Must call handleServerUrlChange so selectedServerUrl is set in state.
    await act(async () => {
      result.current.handleServerUrlChange("http://192.168.1.1:3001");
      await result.current.handleJoinServer("http://192.168.1.1:3001");
    });
    // setSelectedRoomId must flush before handleConnectAsCamera reads the
    // updated closure, so use separate act() calls.
    await act(async () => {
      result.current.setSelectedRoomId("room-a");
    });
    act(() => {
      result.current.handleConnectAsCamera();
    });

    expect(mockNavigation.navigate).toHaveBeenCalledWith(SCREEN_NAMES.CAMERA, {
      serverUrl: "http://192.168.1.1:3001",
      roomId: "room-a",
    });
  });
});

// ── handleQRScan ──────────────────────────────────────────────────────────────

describe("handleQRScan", () => {
  it("advances to room phase and populates rooms from the scanned server", async () => {
    const { result } = renderHook(() => useJoinRoom());
    const data = ConnectionData.fromManualInput(
      "http://192.168.1.1:3001",
      "scanned-room",
    );

    act(() => {
      result.current.handleQRScan(data);
    });
    // handleQRScan fires handleJoinServer as void — waitFor polls inside act()
    // boundaries until all async state updates from handleJoinServer settle.
    await waitFor(() => expect(result.current.phase).toBe("room"));

    expect(result.current.selectedRoomId).toBe("scanned-room");
    expect(result.current.showQR).toBe(false);
    expect(mockFetchActiveRooms).toHaveBeenCalledWith(
      "http://192.168.1.1:3001",
    );
  });

  it("closes the QR scanner even when the server request fails", async () => {
    mockFetchActiveRooms.mockRejectedValueOnce(new Error("unreachable"));
    const { result } = renderHook(() => useJoinRoom());
    const data = ConnectionData.fromManualInput("http://dead:3001", "r");

    await act(async () => {
      result.current.setShowQR(true);
    });
    // Use async act so microtasks (the rejected fetchActiveRooms) are drained
    // before control returns to the test — prevents an out-of-act state update.
    await act(async () => {
      result.current.handleQRScan(data);
    });
    await waitFor(() => expect(result.current.serverStatus).toBe("error"));

    expect(result.current.showQR).toBe(false);
  });
});

// ── togglePrivateRoom ─────────────────────────────────────────────────────────

describe("togglePrivateRoom", () => {
  it("flips isPrivateRoom and clears errors", async () => {
    const { result } = renderHook(() => useJoinRoom());

    // Cause an error first
    await act(async () => {
      await result.current.handleConnect();
    });
    expect(result.current.errors.roomId).toBeTruthy();

    act(() => {
      result.current.togglePrivateRoom();
    });
    expect(result.current.isPrivateRoom).toBe(true);
    expect(result.current.errors).toEqual({});

    act(() => {
      result.current.togglePrivateRoom();
    });
    expect(result.current.isPrivateRoom).toBe(false);
  });
});
