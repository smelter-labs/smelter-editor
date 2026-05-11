import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useJoinLobby } from "../useJoinLobby";
import { SCREEN_NAMES } from "../../../navigation/navigationTypes";
import { ConnectionStatus } from "../../../types/connection";

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
    createRoom: vi.fn(),
    fetchRoomState: vi.fn(),
  },
}));

vi.mock("../../../services/websocketService", () => ({
  wsService: {
    connect: vi.fn(),
  },
}));

// ── Store mocks ───────────────────────────────────────────────────────────────

const mockSetCredentials = vi.fn();
const mockSetError = vi.fn();
const mockSetStatus = vi.fn();
const mockSetTimelinePlaying = vi.fn();

vi.mock("../../../store/connectionStore", () => ({
  useConnectionStore: Object.assign(
    vi.fn(() => ({
      setCredentials: mockSetCredentials,
      setError: mockSetError,
      setStatus: mockSetStatus,
    })),
    {
      getState: () => ({
        setCredentials: mockSetCredentials,
        setError: mockSetError,
        setStatus: mockSetStatus,
        setTimelinePlaying: mockSetTimelinePlaying,
      }),
    },
  ),
}));

const mockSetInputs = vi.fn();
vi.mock("../../../store/inputsStore", () => ({
  useInputsStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: () => ({ setInputs: mockSetInputs }),
    },
  ),
}));

const mockSetLayers = vi.fn();
const mockSetResolution = vi.fn();
const mockSetGridConfig = vi.fn();
vi.mock("../../../store/layoutStore", () => ({
  useLayoutStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: () => ({
        setLayers: mockSetLayers,
        setResolution: mockSetResolution,
        setGridConfig: mockSetGridConfig,
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

const mockCreateRoom = apiService.createRoom as ReturnType<typeof vi.fn>;
const mockFetchRoomState = apiService.fetchRoomState as ReturnType<
  typeof vi.fn
>;
const mockWsConnect = wsService.connect as ReturnType<typeof vi.fn>;

const ROOM_STATE = {
  inputs: [],
  layers: [{ id: "layer-1", inputs: [] }],
  resolution: { width: 1920, height: 1080 },
  isTimelinePlaying: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateRoom.mockResolvedValue("new-room-id");
  mockFetchRoomState.mockResolvedValue(ROOM_STATE);
  mockWsConnect.mockResolvedValue(undefined);
});

// ── Initial state ─────────────────────────────────────────────────────────────

describe("initial state", () => {
  it("exposes serverUrl from route params", () => {
    const { result } = renderHook(() => useJoinLobby());
    expect(result.current.serverUrl).toBe("http://192.168.1.1:3001");
  });

  it("starts with createStatus idle and no error", () => {
    const { result } = renderHook(() => useJoinLobby());
    expect(result.current.createStatus).toBe("idle");
    expect(result.current.createError).toBeNull();
  });
});

// ── handleJoinRoom ────────────────────────────────────────────────────────────

describe("handleJoinRoom", () => {
  it("navigates to JOIN_ROOM with serverUrl", () => {
    const { result } = renderHook(() => useJoinLobby());

    act(() => {
      result.current.handleJoinRoom();
    });

    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      SCREEN_NAMES.JOIN_ROOM,
      {
        serverUrl: "http://192.168.1.1:3001",
      },
    );
  });
});

// ── handleCreateRoom — success ────────────────────────────────────────────────

describe("handleCreateRoom success", () => {
  it("calls createRoom then fetchRoomState with the new roomId", async () => {
    const { result } = renderHook(() => useJoinLobby());

    await act(async () => {
      await result.current.handleCreateRoom();
    });

    expect(mockCreateRoom).toHaveBeenCalledWith("http://192.168.1.1:3001");
    expect(mockFetchRoomState).toHaveBeenCalledWith(
      "http://192.168.1.1:3001",
      "new-room-id",
    );
  });

  it("connects the websocket with serverUrl and roomId", async () => {
    const { result } = renderHook(() => useJoinLobby());

    await act(async () => {
      await result.current.handleCreateRoom();
    });

    expect(mockWsConnect).toHaveBeenCalledWith(
      "http://192.168.1.1:3001",
      "new-room-id",
    );
  });

  it("sets credentials and status to Connected", async () => {
    const { result } = renderHook(() => useJoinLobby());

    await act(async () => {
      await result.current.handleCreateRoom();
    });

    expect(mockSetCredentials).toHaveBeenCalledWith(
      "http://192.168.1.1:3001",
      "new-room-id",
    );
    expect(mockSetStatus).toHaveBeenLastCalledWith(ConnectionStatus.Connected);
  });

  it("populates stores with room state data", async () => {
    const { result } = renderHook(() => useJoinLobby());

    await act(async () => {
      await result.current.handleCreateRoom();
    });

    expect(mockSetInputs).toHaveBeenCalledWith(ROOM_STATE.inputs);
    expect(mockSetLayers).toHaveBeenCalledWith(ROOM_STATE.layers);
    expect(mockSetResolution).toHaveBeenCalledWith(ROOM_STATE.resolution);
    expect(mockSetTimelinePlaying).toHaveBeenCalledWith(
      ROOM_STATE.isTimelinePlaying,
    );
  });

  it("computes grid config from resolution and gridFactor", async () => {
    const { result } = renderHook(() => useJoinLobby());

    await act(async () => {
      await result.current.handleCreateRoom();
    });

    // 1920 / 50 = 38.4 → 38, 1080 / 50 = 21.6 → 22
    expect(mockSetGridConfig).toHaveBeenCalledWith(38, 22);
  });

  it("navigates to Main after success", async () => {
    const { result } = renderHook(() => useJoinLobby());

    await act(async () => {
      await result.current.handleCreateRoom();
    });

    expect(mockNavigation.replace).toHaveBeenCalledWith(SCREEN_NAMES.MAIN);
  });
});

// ── handleCreateRoom — failure ────────────────────────────────────────────────

describe("handleCreateRoom failure", () => {
  it("sets createStatus to error on failure", async () => {
    mockCreateRoom.mockRejectedValueOnce(new Error("Network failure"));
    const { result } = renderHook(() => useJoinLobby());

    await act(async () => {
      await result.current.handleCreateRoom();
    });

    expect(result.current.createStatus).toBe("error");
  });

  it("exposes the error message from the thrown Error", async () => {
    mockCreateRoom.mockRejectedValueOnce(new Error("Network failure"));
    const { result } = renderHook(() => useJoinLobby());

    await act(async () => {
      await result.current.handleCreateRoom();
    });

    expect(result.current.createError).toBe("Network failure");
  });

  it("falls back to a generic message for non-Error throws", async () => {
    mockCreateRoom.mockRejectedValueOnce("string error");
    const { result } = renderHook(() => useJoinLobby());

    await act(async () => {
      await result.current.handleCreateRoom();
    });

    expect(result.current.createError).toBe("Failed to create room");
  });

  it("propagates the error to the connection store", async () => {
    mockCreateRoom.mockRejectedValueOnce(new Error("Timeout"));
    const { result } = renderHook(() => useJoinLobby());

    await act(async () => {
      await result.current.handleCreateRoom();
    });

    expect(mockSetError).toHaveBeenCalledWith("Timeout");
  });

  it("does not navigate on failure", async () => {
    mockCreateRoom.mockRejectedValueOnce(new Error("fail"));
    const { result } = renderHook(() => useJoinLobby());

    await act(async () => {
      await result.current.handleCreateRoom();
    });

    expect(mockNavigation.replace).not.toHaveBeenCalled();
  });
});
