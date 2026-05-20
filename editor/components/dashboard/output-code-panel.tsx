'use client';

import dynamic from 'next/dynamic';
import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import {
  generateOutputJsx,
  type OutputJsxState,
} from '@/lib/generate-output-jsx';
import {
  computeCodeDiff,
  hasCodeDiff,
  type CodeDiffHighlight,
} from '@/lib/diff-output-code';
import {
  applyInlineDiffHighlights,
  type SyntaxTreeNode,
} from '@/lib/apply-inline-code-diff';
import createElement from 'react-syntax-highlighter/dist/esm/create-element';
import {
  outputCodePrismTheme,
  OUTPUT_CODE_PANEL_BG,
} from '@/lib/output-code-prism-theme';
import {
  createSnapshot,
  deleteSnapshot,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  OUTPUT_CODE_LIVE_TAB_ID,
  renameSnapshot,
  setActiveTabId,
  setFontSizePx,
  useOutputCodeRoomState,
  type OutputCodeSnapshot,
} from '@/lib/output-code-storage';
import { restoreOutputCodeSnapshot } from '@/lib/restore-output-code-snapshot';
import { useActions } from '@/components/control-panel/contexts/actions-context';
import LoadingSpinner from '@/components/ui/spinner';

const REMOVED_PREVIEW_MAX = 8;

const SyntaxHighlighter = dynamic(
  () => import('react-syntax-highlighter').then((mod) => mod.Prism),
  { ssr: false },
);

type OutputCodePanelProps = OutputJsxState & {
  roomId?: string;
  refreshState?: () => Promise<void>;
};

function CopyIcon() {
  return (
    <svg
      width='10'
      height='10'
      viewBox='0 0 10 10'
      fill='none'
      stroke='currentColor'
      strokeWidth='1'>
      <rect x='3' y='3' width='6' height='6' rx='0.5' />
      <path d='M7 3V1.5a.5.5 0 00-.5-.5H1.5a.5.5 0 00-.5.5v5a.5.5 0 00.5.5H3' />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width='10'
      height='10'
      viewBox='0 0 10 10'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'>
      <polyline points='2,5 4.5,7.5 8,2.5' />
    </svg>
  );
}

function DiffBadge({ highlight }: { highlight: CodeDiffHighlight }) {
  const parts: string[] = [];
  if (highlight.addedCount > 0) parts.push(`+${highlight.addedCount}`);
  if (highlight.removedCount > 0) parts.push(`−${highlight.removedCount}`);
  if (parts.length === 0) return null;

  return (
    <span className='text-[10px] uppercase tracking-wider text-[#00f3ff]'>
      {parts.join(' ')}
    </span>
  );
}

function RemovedLinesSection({
  lines,
  fontSizePx,
}: {
  lines: string[];
  fontSizePx: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const preview = lines.slice(0, REMOVED_PREVIEW_MAX);
  const remaining = lines.length - preview.length;

  return (
    <div className='shrink-0 border-t border-[#3a494b]/40'>
      <button
        type='button'
        onClick={() => setExpanded((v) => !v)}
        className='flex w-full items-center gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wider text-red-400/90 hover:text-red-300 transition-colors cursor-pointer'>
        <span>Removed ({lines.length})</span>
        <span className='text-[#849495]'>{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <pre
          className='px-3 pb-2 leading-relaxed font-mono text-red-300/80 whitespace-pre overflow-auto max-h-32'
          style={{ fontSize: `${fontSizePx}px` }}>
          {preview.join('\n')}
          {remaining > 0 && `\n…and ${remaining} more`}
        </pre>
      )}
    </div>
  );
}

function FontSizeControls({
  fontSizePx,
  onDecrease,
  onIncrease,
}: {
  fontSizePx: number;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className='flex items-center gap-1 shrink-0'>
      <button
        type='button'
        onClick={onDecrease}
        disabled={fontSizePx <= MIN_FONT_SIZE_PX}
        className='inline-flex h-5 w-5 items-center justify-center text-[#849495] hover:text-[#b9cacb] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer'
        aria-label='Decrease font size'>
        −
      </button>
      <span className='min-w-[2.5rem] text-center tabular-nums text-[#b9cacb]'>
        {fontSizePx}px
      </span>
      <button
        type='button'
        onClick={onIncrease}
        disabled={fontSizePx >= MAX_FONT_SIZE_PX}
        className='inline-flex h-5 w-5 items-center justify-center text-[#849495] hover:text-[#b9cacb] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer'
        aria-label='Increase font size'>
        +
      </button>
    </div>
  );
}

function SnapshotTab({
  snapshot,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  snapshot: OutputCodeSnapshot;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (label: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(snapshot.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) setDraft(snapshot.label);
  }, [snapshot.label, isEditing]);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== snapshot.label) {
      onRename(trimmed);
    } else {
      setDraft(snapshot.label);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(snapshot.label);
      setIsEditing(false);
    }
  };

  return (
    <div
      className={`group relative flex shrink-0 items-center border-b-2 transition-colors ${
        isActive
          ? 'border-[#00f3ff] text-[#00f3ff]'
          : 'border-transparent text-[#849495] hover:text-[#b9cacb]'
      }`}>
      {isEditing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
          className='mx-1 my-0.5 w-24 bg-[#111] border border-[#00f3ff]/40 px-1.5 py-0.5 text-[10px] text-[#b9cacb] outline-none'
        />
      ) : (
        <button
          type='button'
          onClick={onSelect}
          onDoubleClick={(e) => {
            e.preventDefault();
            setIsEditing(true);
          }}
          className='px-2.5 py-1.5 uppercase tracking-wider cursor-pointer whitespace-nowrap'
          title='Double-click to rename'>
          {snapshot.label}
        </button>
      )}
      {!isEditing && (
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className='absolute -right-0.5 -top-0.5 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-[#111] text-[#849495] hover:text-red-400 group-hover:flex cursor-pointer'
          aria-label={`Delete snapshot ${snapshot.label}`}>
          ×
        </button>
      )}
    </div>
  );
}

function CodeTabBar({
  activeTabId,
  snapshots,
  liveChanged,
  onSelectLive,
  onSelectSnapshot,
  onSaveLive,
  onDeleteSnapshot,
  onRenameSnapshot,
}: {
  activeTabId: 'live' | string;
  snapshots: OutputCodeSnapshot[];
  liveChanged: boolean;
  onSelectLive: () => void;
  onSelectSnapshot: (id: string) => void;
  onSaveLive: () => void;
  onDeleteSnapshot: (id: string) => void;
  onRenameSnapshot: (id: string, label: string) => void;
}) {
  const isLiveActive = activeTabId === OUTPUT_CODE_LIVE_TAB_ID;

  return (
    <div className='flex items-stretch border-b border-[#3a494b]/20 shrink-0'>
      <div className='flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto px-2'>
        <button
          type='button'
          onClick={onSelectLive}
          className={`flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 border-b-2 uppercase tracking-wider transition-colors cursor-pointer ${
            isLiveActive
              ? 'border-[#bded00] text-[#bded00]'
              : 'border-transparent text-[#849495] hover:text-[#b9cacb]'
          }`}>
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isLiveActive ? 'bg-[#bded00] animate-pulse' : 'bg-[#849495]/60'
            }`}
          />
          LIVE
          {!isLiveActive && liveChanged && (
            <span className='text-[9px] normal-case tracking-normal text-amber-400/90'>
              changed
            </span>
          )}
        </button>

        {snapshots.map((snapshot) => (
          <SnapshotTab
            key={snapshot.id}
            snapshot={snapshot}
            isActive={activeTabId === snapshot.id}
            onSelect={() => onSelectSnapshot(snapshot.id)}
            onDelete={() => onDeleteSnapshot(snapshot.id)}
            onRename={(label) => onRenameSnapshot(snapshot.id, label)}
          />
        ))}
      </div>

      <button
        type='button'
        onClick={onSaveLive}
        className='shrink-0 border-l border-[#3a494b]/20 px-3 py-1.5 text-[#849495] hover:text-[#bded00] uppercase tracking-wider transition-colors cursor-pointer'>
        + Save
      </button>
    </div>
  );
}

function CodeHighlighter({
  code,
  style,
  highlight,
  fontSizePx,
}: {
  code: string;
  style: Record<string, CSSProperties> | undefined;
  highlight: CodeDiffHighlight | null;
  fontSizePx: number;
}) {
  const renderer = useCallback(
    ({
      rows,
      stylesheet,
      useInlineStyles,
    }: {
      rows: SyntaxTreeNode[];
      stylesheet: Record<string, CSSProperties>;
      useInlineStyles: boolean;
    }) =>
      rows.map((node, index) => {
        const lineNumber = index + 1;
        const ranges = highlight?.changedRanges.get(lineNumber);
        const nextNode =
          ranges && ranges.length > 0
            ? applyInlineDiffHighlights(node, ranges)
            : node;

        return createElement({
          node: nextNode as Parameters<typeof createElement>[0]['node'],
          stylesheet,
          useInlineStyles,
          key: `code-segment-${index}`,
        });
      }),
    [highlight],
  );

  if (!style) {
    return (
      <pre
        className='p-3 leading-relaxed font-mono text-[#b9cacb] whitespace-pre overflow-auto'
        style={{ fontSize: `${fontSizePx}px` }}>
        {code}
      </pre>
    );
  }

  return (
    <SyntaxHighlighter
      language='tsx'
      style={style}
      wrapLines
      showLineNumbers
      renderer={renderer as never}
      lineNumberStyle={{
        minWidth: '2.5em',
        paddingRight: '1em',
        color: '#849495',
        fontSize: `${fontSizePx}px`,
        userSelect: 'none',
      }}
      customStyle={{
        margin: 0,
        padding: '12px',
        background: 'transparent',
        fontSize: `${fontSizePx}px`,
        lineHeight: 1.5,
      }}
      codeTagProps={{
        style: { fontFamily: 'ui-monospace, monospace' },
      }}>
      {code}
    </SyntaxHighlighter>
  );
}

export function OutputCodePanel({
  roomId,
  refreshState,
  inputs,
  layers,
  resolution,
  outputShaders,
  viewportTop,
  viewportLeft,
  viewportWidth,
  viewportHeight,
  viewportTransitionDurationMs,
  viewportTransitionEasing,
}: OutputCodePanelProps) {
  const actions = useActions();
  const sceneState = useMemo(
    (): OutputJsxState => ({
      inputs,
      layers,
      resolution,
      outputShaders,
      viewportTop,
      viewportLeft,
      viewportWidth,
      viewportHeight,
      viewportTransitionDurationMs,
      viewportTransitionEasing,
    }),
    [
      inputs,
      layers,
      resolution,
      outputShaders,
      viewportTop,
      viewportLeft,
      viewportWidth,
      viewportHeight,
      viewportTransitionDurationMs,
      viewportTransitionEasing,
    ],
  );

  const liveCode = useMemo(
    () => generateOutputJsx(sceneState),
    [sceneState],
  );

  const { state: roomState, setState: setRoomState } =
    useOutputCodeRoomState(roomId);

  const displayedCode = useMemo(() => {
    if (roomState.activeTabId === OUTPUT_CODE_LIVE_TAB_ID) return liveCode;
    return (
      roomState.snapshots.find((s) => s.id === roomState.activeTabId)?.code ??
      liveCode
    );
  }, [roomState.activeTabId, roomState.snapshots, liveCode]);

  const activeSnapshot = useMemo(
    () =>
      roomState.activeTabId === OUTPUT_CODE_LIVE_TAB_ID
        ? null
        : roomState.snapshots.find((s) => s.id === roomState.activeTabId) ??
          null,
    [roomState.activeTabId, roomState.snapshots],
  );

  const liveChanged =
    roomState.activeTabId !== OUTPUT_CODE_LIVE_TAB_ID &&
    activeSnapshot !== null &&
    liveCode !== activeSnapshot.code;

  const lineCount = useMemo(
    () => displayedCode.split('\n').length,
    [displayedCode],
  );

  const [copied, setCopied] = useState(false);
  const [highlight, setHighlight] = useState<CodeDiffHighlight | null>(null);
  const [restorePending, setRestorePending] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const prevCodeRef = useRef(displayedCode);

  useEffect(() => {
    const prev = prevCodeRef.current;
    if (prev !== displayedCode) {
      const diff = computeCodeDiff(prev, displayedCode);
      if (hasCodeDiff(diff)) {
        setHighlight(diff);
      }
      prevCodeRef.current = displayedCode;
    }
  }, [displayedCode]);

  const handleClearChanges = useCallback(() => {
    setHighlight(null);
  }, []);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(displayedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [displayedCode]);

  const handleSaveLive = useCallback(() => {
    const result = createSnapshot(roomState, liveCode, sceneState);
    setRoomState(result.state);
  }, [roomState, liveCode, sceneState, setRoomState]);

  const canRestore =
    !!roomId &&
    !!refreshState &&
    !!activeSnapshot?.sceneState &&
    !isRestoring;

  const handleRestore = useCallback(async () => {
    if (!roomId || !refreshState || !activeSnapshot?.sceneState) return;
    setIsRestoring(true);
    try {
      await restoreOutputCodeSnapshot(
        roomId,
        activeSnapshot.sceneState,
        new Set(inputs.map((input) => input.inputId)),
        {
          updateRoom: actions.updateRoom,
          updateInput: actions.updateInput,
          hideInput: actions.hideInput,
          showInput: actions.showInput,
        },
      );
      await refreshState();
      setRoomState(setActiveTabId(roomState, OUTPUT_CODE_LIVE_TAB_ID));
      setHighlight(null);
      prevCodeRef.current = liveCode;
      setRestorePending(false);
    } catch (error) {
      console.error('[output-code] restore failed', error);
    } finally {
      setIsRestoring(false);
    }
  }, [
    roomId,
    refreshState,
    activeSnapshot,
    inputs,
    actions,
    setRoomState,
    roomState,
    liveCode,
  ]);

  const handleDecreaseFont = useCallback(() => {
    setRoomState(setFontSizePx(roomState, roomState.fontSizePx - 1));
  }, [roomState, setRoomState]);

  const handleIncreaseFont = useCallback(() => {
    setRoomState(setFontSizePx(roomState, roomState.fontSizePx + 1));
  }, [roomState, setRoomState]);

  return (
    <div
      className='relative flex flex-col h-full min-h-0 font-mono text-[10px]'
      style={{ backgroundColor: OUTPUT_CODE_PANEL_BG }}>
      {isRestoring && (
        <div className='absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[#080808]/90 backdrop-blur-sm'>
          <LoadingSpinner
            size='md'
            variant='spinner'
            className='border-[#3a494b] border-t-[#00f3ff]'
          />
          <span className='text-[10px] uppercase tracking-widest text-[#00f3ff]'>
            Restoring snapshot…
          </span>
        </div>
      )}
      <div className='flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[#3a494b]/20 shrink-0 text-[#b9cacb]'>
        <div className='flex items-center gap-2 min-w-0'>
          <span className='text-[10px] uppercase tracking-wider text-[#849495]'>
            {lineCount} lines
          </span>
          {highlight && hasCodeDiff(highlight) && (
            <>
              <DiffBadge highlight={highlight} />
              <button
                type='button'
                onClick={handleClearChanges}
                className='text-[10px] uppercase tracking-wider text-[#849495] hover:text-[#b9cacb] transition-colors cursor-pointer'>
                Hide changes
              </button>
            </>
          )}
        </div>
        <div className='flex items-center gap-3 shrink-0'>
          {canRestore && (
            <>
              {restorePending ? (
                <div className='flex items-center gap-2'>
                  <span className='text-[10px] uppercase tracking-wider text-amber-400/90'>
                    Apply snapshot?
                  </span>
                  <button
                    type='button'
                    onClick={() => void handleRestore()}
                    className='text-[10px] uppercase tracking-wider text-[#00f3ff] hover:text-[#b9cacb] transition-colors cursor-pointer'>
                    Restore
                  </button>
                  <button
                    type='button'
                    onClick={() => setRestorePending(false)}
                    className='text-[10px] uppercase tracking-wider text-[#849495] hover:text-[#b9cacb] transition-colors cursor-pointer'>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type='button'
                  onClick={() => setRestorePending(true)}
                  className='text-[10px] uppercase tracking-wider text-[#849495] hover:text-[#00f3ff] transition-colors cursor-pointer'>
                  Restore
                </button>
              )}
              <span className='text-[#3a494b]'>|</span>
            </>
          )}
          <FontSizeControls
            fontSizePx={roomState.fontSizePx}
            onDecrease={handleDecreaseFont}
            onIncrease={handleIncreaseFont}
          />
          <span className='text-[#3a494b]'>|</span>
          <button
            type='button'
            onClick={handleCopy}
            className='flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#849495] hover:text-[#b9cacb] transition-colors cursor-pointer'>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <CodeTabBar
        activeTabId={roomState.activeTabId}
        snapshots={roomState.snapshots}
        liveChanged={liveChanged}
        onSelectLive={() => {
          setRestorePending(false);
          setRoomState(setActiveTabId(roomState, OUTPUT_CODE_LIVE_TAB_ID));
        }}
        onSelectSnapshot={(id) => {
          setRestorePending(false);
          setRoomState(setActiveTabId(roomState, id));
        }}
        onSaveLive={handleSaveLive}
        onDeleteSnapshot={(id) =>
          setRoomState(deleteSnapshot(roomState, id))
        }
        onRenameSnapshot={(id, label) =>
          setRoomState(renameSnapshot(roomState, id, label))
        }
      />

      <div className='flex-1 min-h-0 overflow-auto'>
        <CodeHighlighter
          code={displayedCode}
          style={outputCodePrismTheme}
          highlight={highlight}
          fontSizePx={roomState.fontSizePx}
        />
      </div>
      {highlight && highlight.removedLines.length > 0 && (
        <RemovedLinesSection
          lines={highlight.removedLines}
          fontSizePx={roomState.fontSizePx}
        />
      )}
    </div>
  );
}
