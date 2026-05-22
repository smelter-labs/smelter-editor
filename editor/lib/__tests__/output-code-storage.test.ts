import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSnapshot,
  DEFAULT_FONT_SIZE_PX,
  deleteSnapshot,
  loadOutputCodeRoomState,
  MAX_SNAPSHOTS,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  OUTPUT_CODE_LIVE_TAB_ID,
  renameSnapshot,
  saveOutputCodeRoomState,
  setActiveTabId,
  setFontSizePx,
  type OutputCodeRoomState,
} from '../output-code-storage';

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

const ROOM_ID = 'room-test';

function defaultState(): OutputCodeRoomState {
  return {
    schemaVersion: 1,
    fontSizePx: DEFAULT_FONT_SIZE_PX,
    activeTabId: OUTPUT_CODE_LIVE_TAB_ID,
    snapshots: [],
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: createLocalStorageMock(),
    configurable: true,
  });
  localStorage.clear();
});

const mockSceneState = {
  inputs: [],
  layers: [],
  resolution: { width: 1920, height: 1080 },
};

describe('output-code-storage', () => {
  it('loads default state when nothing stored', () => {
    expect(loadOutputCodeRoomState(ROOM_ID)).toEqual(defaultState());
  });

  it('roundtrips save and load', () => {
    const state: OutputCodeRoomState = {
      schemaVersion: 1,
      fontSizePx: 12,
      activeTabId: 'snap-1',
      snapshots: [
        {
          id: 'snap-1',
          label: '12:00:00',
          code: '<View />',
          createdAt: 1,
          lineCount: 1,
        },
      ],
    };
    saveOutputCodeRoomState(ROOM_ID, state);
    expect(loadOutputCodeRoomState(ROOM_ID)).toEqual(state);
  });

  it('dedupes identical live code into existing snapshot tab', () => {
    const initial: OutputCodeRoomState = {
      ...defaultState(),
      snapshots: [
        {
          id: 'snap-a',
          label: 'A',
          code: 'same-code',
          createdAt: 1,
          lineCount: 1,
        },
      ],
    };

    const result = createSnapshot(initial, 'same-code', mockSceneState);
    expect(result.deduped).toBe(true);
    expect(result.snapshotId).toBe('snap-a');
    expect(result.state.snapshots).toHaveLength(1);
    expect(result.state.activeTabId).toBe('snap-a');
  });

  it('creates a new snapshot for new live code', () => {
    const result = createSnapshot(
      defaultState(),
      'new-code\nline2',
      mockSceneState,
    );
    expect(result.deduped).toBe(false);
    expect(result.state.snapshots).toHaveLength(1);
    expect(result.state.snapshots[0]?.code).toBe('new-code\nline2');
    expect(result.state.snapshots[0]?.lineCount).toBe(2);
    expect(result.state.snapshots[0]?.sceneState).toEqual(mockSceneState);
    expect(result.state.activeTabId).toBe(result.snapshotId);
  });

  it('keeps only the newest snapshots when over limit', () => {
    let state = defaultState();
    for (let i = 0; i < MAX_SNAPSHOTS + 3; i++) {
      state = createSnapshot(state, `code-${i}`, mockSceneState).state;
    }
    expect(state.snapshots).toHaveLength(MAX_SNAPSHOTS);
    expect(state.snapshots[0]?.code).toBe('code-3');
    expect(state.snapshots.at(-1)?.code).toBe(`code-${MAX_SNAPSHOTS + 2}`);
  });

  it('falls back to live when deleting active snapshot', () => {
    const state: OutputCodeRoomState = {
      ...defaultState(),
      activeTabId: 'snap-x',
      snapshots: [
        {
          id: 'snap-x',
          label: 'X',
          code: 'x',
          createdAt: 1,
          lineCount: 1,
        },
      ],
    };
    const next = deleteSnapshot(state, 'snap-x');
    expect(next.activeTabId).toBe(OUTPUT_CODE_LIVE_TAB_ID);
    expect(next.snapshots).toHaveLength(0);
  });

  it('clamps font size', () => {
    expect(setFontSizePx(defaultState(), 4).fontSizePx).toBe(MIN_FONT_SIZE_PX);
    expect(setFontSizePx(defaultState(), 99).fontSizePx).toBe(MAX_FONT_SIZE_PX);
    expect(setFontSizePx(defaultState(), 11.7).fontSizePx).toBe(12);
  });

  it('renames snapshot labels', () => {
    const state: OutputCodeRoomState = {
      ...defaultState(),
      snapshots: [
        {
          id: 'snap-1',
          label: 'Old',
          code: 'x',
          createdAt: 1,
          lineCount: 1,
        },
      ],
    };
    const next = renameSnapshot(state, 'snap-1', '  My label  ');
    expect(next.snapshots[0]?.label).toBe('My label');
  });

  it('ignores empty rename labels', () => {
    const state: OutputCodeRoomState = {
      ...defaultState(),
      snapshots: [
        {
          id: 'snap-1',
          label: 'Old',
          code: 'x',
          createdAt: 1,
          lineCount: 1,
        },
      ],
    };
    expect(renameSnapshot(state, 'snap-1', '   ')).toBe(state);
  });
});
