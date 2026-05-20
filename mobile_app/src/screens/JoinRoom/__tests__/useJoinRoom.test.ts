import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useJoinRoom } from "../useJoinRoom";
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
  useRoute: vi.fn(() => ({
    params: { serverUrl: "http://192.168.1.1:3001" },
  })),
}));

// ── Service mocks ─────────────────────────────────────────────────────────────

vi.mock("../../../services/apiService", () => ({
  apiService: {
    fetchActiveRooms: vi.fn(),
    fetchRoomState: vi.fn(),
  },
}));

vi.mock("../../../services/websocketService", () => ({
  wsService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

// ── Store mocks ───────────────────────────────────────────────────────────────

vi.mock("../../../store/connectionStore", () => {
  const state = {
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
import { useRoute } from "@react-navigation/native";

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
  (mockNavigation.navigate as ReturnType<typeof vi.fn>).mockReset();
  (mockNavigation.replace as ReturnType<typeof vi.fn>).mockReset();
  (useRoute as ReturnType<typeof vi.fn>).mockReturnValue({
    params: { serverUrl: "http://192.168.1.1:3001" },
  });
  mockFetchActiveRooms.mockResolvedValue(ROOMS);
  mockFetchRoomState.mockResolvedValue(ROOM_STATE);
  mockWsConnect.mockResolvedValue(undefined);
});

// ── Room polling ──────────────────────────────────────────────────────────────

describe("room polling", () => {
  it("fetches rooms on mount using serverUrl from route params", async () => {
    const { result } = renderHook(() => useJoinRoom());

    await waitFor(() => expect(result.current.rooms).toHaveLength(2));

    expect(mockFetchActiveRooms).toHaveBeenCalledWith(
      "http://192.168.1.1:3001",
    );
  });

  it("deduplicates rooms with the same roomId", async () => {
    mockFetchActiveRooms.mockResolvedValue([
      { roomId: "dup", roomName: "First" },
      { roomId: "dup", roomName: "Second" },
      { roomId: "other", roomName: "Other" },
    ]);

    const { result } = renderHook(() => useJoinRoom());

    await waitFor(() => expect(result.current.rooms).toHaveLength(2));
    expect(result.current.rooms[0].roomId).toBe("dup");
    expect(result.current.rooms[1].roomId).toBe("other");
  });

  it("initialises selectedRoomId from route param initialRoomId", async () => {
    (useRoute as ReturnType<typeof vi.fn>).mockReturnValue({
      params: {
        serverUrl: "http://192.168.1.1:3001",
        initialRoomId: "pre-room",
      },
    });

    const { result } = renderHook(() => useJoinRoom());

    expect(result.current.selectedRoomId).toBe("pre-room");
  });
});

// ── handleConnect ─────────────────────────────────────────────────────────────

describe("handleConnect", () => {
  it("requires a roomId — sets errors.roomId when absent", async () => {
    const { result } = renderHook(() => useJoinRoom());

    await act(async () => {
      await result.current.handleConnect();
    });

    expect(result.current.errors.roomId).toBeTruthy();
    expect(mockFetchRoomState).not.toHaveBeenCalled();
  });

  it("navigates to Main on success", async () => {
    const { result } = renderHook(() => useJoinRoom());

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
    expect(mockNavigation.replace).toHaveBeenCalledWith(SCREEN_NAMES.MAIN);
    expect(result.current.errors).toEqual({});
  });

  it("uses privateRoomId when isPrivateRoom is toggled on", async () => {
    const { result } = renderHook(() => useJoinRoom());

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
    const { result } = renderHook(() => useJoinRoom());

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
    const { result } = renderHook(() => useJoinRoom());

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
    const { result } = renderHook(() => useJoinRoom());

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
  it("requires a roomId — sets errors.roomId when absent", () => {
    const { result } = renderHook(() => useJoinRoom());

    act(() => {
      result.current.handleConnectAsCamera();
    });

    expect(result.current.errors.roomId).toBeTruthy();
  });

  it("navigates to Camera screen with serverUrl and roomId", async () => {
    const { result } = renderHook(() => useJoinRoom());

    act(() => {
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

  it("uses privateRoomId when isPrivateRoom is on", async () => {
    const { result } = renderHook(() => useJoinRoom());

    act(() => {
      result.current.togglePrivateRoom();
      result.current.setPrivateRoomId("cam-room");
    });
    act(() => {
      result.current.handleConnectAsCamera();
    });

    expect(mockNavigation.navigate).toHaveBeenCalledWith(SCREEN_NAMES.CAMERA, {
      serverUrl: expect.any(String),
      roomId: "cam-room",
    });
  });
});

// ── togglePrivateRoom ─────────────────────────────────────────────────────────

describe("togglePrivateRoom", () => {
  it("flips isPrivateRoom and clears errors", async () => {
    const { result } = renderHook(() => useJoinRoom());

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

// ── handleQRScan ──────────────────────────────────────────────────────────────

describe("handleQRScan", () => {
  it("sets selectedRoomId and closes QR when scanned server matches current", async () => {
    const { result } = renderHook(() => useJoinRoom());
    const data = ConnectionData.fromManualInput(
      "http://192.168.1.1:3001",
      "scanned-room",
    );

    await act(async () => {
      result.current.setShowQR(true);
    });
    act(() => {
      result.current.handleQRScan(data);
    });

    expect(result.current.selectedRoomId).toBe("scanned-room");
    expect(result.current.isPrivateRoom).toBe(true);
    expect(result.current.showQR).toBe(false);
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  it("navigates to JOIN_ROOM with new serverUrl when scanned server differs", async () => {
    const { result } = renderHook(() => useJoinRoom());
    const data = ConnectionData.fromManualInput(
      "http://other-server:3001",
      "room-x",
    );

    act(() => {
      result.current.handleQRScan(data);
    });

    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      SCREEN_NAMES.JOIN_ROOM,
      {
        serverUrl: "http://other-server:3001",
        initialRoomId: "room-x",
      },
    );
    expect(result.current.showQR).toBe(false);
  });
});
