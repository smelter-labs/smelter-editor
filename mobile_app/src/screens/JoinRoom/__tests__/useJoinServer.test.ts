import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useJoinServer } from "../useJoinServer";
import { SCREEN_NAMES } from "../../../navigation/navigationTypes";
import { ConnectionData } from "../../../utils/connectionUtils";

// ── Navigation mock ───────────────────────────────────────────────────────────

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
  },
}));

vi.mock("../../../store/connectionStore", () => ({
  useConnectionStore: vi.fn(() => ({ serverUrl: "" })),
}));

import { apiService } from "../../../services/apiService";

const mockFetchActiveRooms = apiService.fetchActiveRooms as ReturnType<
  typeof vi.fn
>;

const ROOMS = [
  { roomId: "room-a", roomName: "Room A" },
  { roomId: "room-b", roomName: "Room B" },
];

beforeEach(() => {
  vi.clearAllMocks();
  (mockNavigation.navigate as ReturnType<typeof vi.fn>).mockReset();
  void (AsyncStorage as any).clear();
  mockFetchActiveRooms.mockResolvedValue(ROOMS);
});

// ── handleJoinServer ──────────────────────────────────────────────────────────

describe("handleJoinServer", () => {
  it("sets serverStatus to loading then success and navigates to JoinRoom", async () => {
    const { result } = renderHook(() => useJoinServer());

    await act(async () => {
      await result.current.handleJoinServer("http://192.168.1.1:3001");
    });

    expect(result.current.serverStatus).toBe("success");
    expect(result.current.serverError).toBeNull();
    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      SCREEN_NAMES.JOIN_LOBBY,
      {
        serverUrl: "http://192.168.1.1:3001",
      },
    );
  });

  it("rejects an empty URL", async () => {
    const { result } = renderHook(() => useJoinServer());

    await act(async () => {
      await result.current.handleJoinServer("");
    });

    expect(result.current.serverStatus).toBe("error");
    expect(result.current.serverError).toBeTruthy();
    expect(mockFetchActiveRooms).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  it("rejects a malformed URL", async () => {
    const { result } = renderHook(() => useJoinServer());

    await act(async () => {
      await result.current.handleJoinServer("not a url at all!!!");
    });

    expect(result.current.serverStatus).toBe("error");
    expect(mockFetchActiveRooms).not.toHaveBeenCalled();
  });

  it("sets serverStatus to error when fetch throws", async () => {
    mockFetchActiveRooms.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const { result } = renderHook(() => useJoinServer());

    await act(async () => {
      await result.current.handleJoinServer("http://unreachable:3001");
    });

    expect(result.current.serverStatus).toBe("error");
    expect(result.current.serverError).toContain("ECONNREFUSED");
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  it("auto-saves a new URL to the saved list after success", async () => {
    const { result } = renderHook(() => useJoinServer());
    await waitFor(() => expect(result.current.savedUrls).toEqual([]));

    await act(async () => {
      await result.current.handleJoinServer("http://new-server:3001");
    });

    expect(result.current.savedUrls).toContain("http://new-server:3001");
  });

  it("does not duplicate an already-saved URL", async () => {
    const { result } = renderHook(() => useJoinServer());

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

    const { result } = renderHook(() => useJoinServer());

    act(() => {
      void result.current.handleJoinServer("http://slow:3001");
    });
    await act(async () => {
      result.current.handleServerUrlChange("http://fast:3001");
      await result.current.handleJoinServer("http://fast:3001");
    });

    // Only the fast call should have navigated
    expect(mockNavigation.navigate).toHaveBeenCalledTimes(1);
    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      SCREEN_NAMES.JOIN_LOBBY,
      {
        serverUrl: "http://fast:3001",
      },
    );
  });
});

// ── handleServerUrlChange ────────────────────────────────────────────────────

describe("handleServerUrlChange", () => {
  it("resets serverStatus to idle", async () => {
    const { result } = renderHook(() => useJoinServer());

    await act(async () => {
      await result.current.handleJoinServer("http://192.168.1.1:3001");
    });
    expect(result.current.serverStatus).toBe("success");

    act(() => {
      result.current.handleServerUrlChange("http://192.168.1.2:3001");
    });

    expect(result.current.serverStatus).toBe("idle");
    expect(result.current.serverError).toBeNull();
  });
});

// ── Saved URL history ─────────────────────────────────────────────────────────

describe("saved URL history", () => {
  it("loads saved URLs from AsyncStorage on mount", async () => {
    await AsyncStorage.setItem(
      "saved-server-urls",
      JSON.stringify(["http://persisted:3001"]),
    );

    const { result } = renderHook(() => useJoinServer());

    await waitFor(() =>
      expect(result.current.savedUrls).toContain("http://persisted:3001"),
    );
  });

  it("removeSavedUrl drops the URL from the list and persists", async () => {
    const { result } = renderHook(() => useJoinServer());

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
    const { result } = renderHook(() => useJoinServer());
    await act(async () => {});
    const before = result.current.savedUrls.length;
    act(() => {
      result.current.removeSavedUrl("http://unknown:9999");
    });
    expect(result.current.savedUrls).toHaveLength(before);
  });

  it("handles corrupt AsyncStorage data gracefully", async () => {
    await AsyncStorage.setItem("saved-server-urls", "not-valid-json{{");
    const { result } = renderHook(() => useJoinServer());
    await waitFor(() => {
      expect(result.current.savedUrls).toEqual([]);
    });
  });
});

// ── Health checks ─────────────────────────────────────────────────────────────

describe("health checks", () => {
  it("marks a URL healthy after fetchActiveRooms succeeds", async () => {
    await AsyncStorage.setItem(
      "saved-server-urls",
      JSON.stringify(["http://healthy:3001"]),
    );

    const { result } = renderHook(() => useJoinServer());

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

    const { result } = renderHook(() => useJoinServer());

    await waitFor(() =>
      expect(result.current.healthStatus["http://dead:3001"]).toBe("error"),
    );
  });
});

// ── handleQRScan ──────────────────────────────────────────────────────────────

describe("handleQRScan", () => {
  it("navigates to JoinRoom with serverUrl and initialRoomId from scan", async () => {
    const { result } = renderHook(() => useJoinServer());
    const data = ConnectionData.fromManualInput(
      "http://192.168.1.1:3001",
      "scanned-room",
    );

    act(() => {
      result.current.handleQRScan(data);
    });

    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      SCREEN_NAMES.JOIN_ROOM,
      {
        serverUrl: "http://192.168.1.1:3001",
        initialRoomId: "scanned-room",
      },
    );
    expect(result.current.showQR).toBe(false);
  });

  it("closes the QR scanner on scan regardless of server reachability", async () => {
    const { result } = renderHook(() => useJoinServer());
    const data = ConnectionData.fromManualInput("http://dead:3001", "r");

    await act(async () => {
      result.current.setShowQR(true);
    });
    act(() => {
      result.current.handleQRScan(data);
    });

    expect(result.current.showQR).toBe(false);
  });
});
