'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core';
import type {
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  UniqueIdentifier,
  DropAnimation,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Eye,
  EyeOff,
  Layers,
} from 'lucide-react';
import type { Input, Layer, LayerBehaviorConfig } from '@/lib/types';
import type { InputWrapper } from '../hooks/use-control-panel-state';
import InputEntry from '@/components/control-panel/input-entry/input-entry';
import { ErrorBoundary } from '@/components/error-boundary';
import { useControlPanelContext } from '../contexts/control-panel-context';
import { useWhipConnectionsContext } from '../contexts/whip-connections-context';
import { useActions } from '../contexts/actions-context';
import { BehaviorSelector } from './BehaviorSelector';
import LoadingSpinner from '@/components/ui/spinner';

// ── Types ────────────────────────────────────────────────────────────────────

type LayersSectionProps = {
  layers: Layer[];
  inputWrappers: InputWrapper[];
  listVersion: number;
  showStreamsSpinner: boolean;
  updateOrder: (wrappers: InputWrapper[]) => Promise<void>;
  openFxInputId: string | null;
  onToggleFx: (inputId: string) => void;
  isSwapping?: boolean;
  selectedInputId: string | null;
  isGuest?: boolean;
  guestInputId?: string | null;
  onLayersChange: (layers: Layer[]) => Promise<void>;
};

type DragItem = {
  type: 'layer' | 'input';
  layerId: string;
  inputId?: string;
};

// ── Sortable layer item ──────────────────────────────────────────────────────

function SortableLayerItem({
  id,
  disabled,
  children,
}: {
  id: UniqueIdentifier;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      {...attributes}
      {...(disabled ? {} : listeners)}>
      {children}
    </div>
  );
}

// ── Sortable input item ──────────────────────────────────────────────────────

function SortableInputItem({
  id,
  disabled,
  children,
}: {
  id: UniqueIdentifier;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        cursor: disabled ? 'default' : 'grab',
      }}
      {...attributes}
      {...(disabled ? {} : listeners)}>
      {children}
    </div>
  );
}

// ── Layer header ─────────────────────────────────────────────────────────────

function LayerHeader({
  layerId,
  layerIndex,
  isCollapsed,
  onToggleCollapse,
  behavior,
  onBehaviorChange,
  isGuest,
}: {
  layerId: string;
  layerIndex: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  behavior: LayerBehaviorConfig | undefined;
  onBehaviorChange: (b: LayerBehaviorConfig | undefined) => void;
  isGuest?: boolean;
}) {
  return (
    <div className='border-b border-neutral-800'>
      <button
        onClick={onToggleCollapse}
        className='w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-neutral-800/50 transition-colors'
        data-no-dnd='true'>
        <span className='text-neutral-500 w-4 flex-shrink-0'>
          {isCollapsed ? (
            <ChevronRight className='w-3.5 h-3.5' />
          ) : (
            <ChevronDown className='w-3.5 h-3.5' />
          )}
        </span>
        <Layers className='w-3.5 h-3.5 text-neutral-500 flex-shrink-0' />
        <span className='text-[11px] font-semibold text-neutral-300 flex-1 text-left truncate'>
          Layer {layerIndex + 1}
        </span>
        {!isGuest && (
          <GripVertical className='w-3.5 h-3.5 text-neutral-600 flex-shrink-0' />
        )}
      </button>
      {!isCollapsed && !isGuest && (
        <div className='px-2 pb-1.5' data-no-dnd='true'>
          <BehaviorSelector behavior={behavior} onChange={onBehaviorChange} />
        </div>
      )}
    </div>
  );
}

// ── Drop animation ───────────────────────────────────────────────────────────

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0.4' } },
  }),
};

// ── Main component ───────────────────────────────────────────────────────────

export function LayersSection({
  layers,
  showStreamsSpinner,
  onToggleFx,
  isSwapping,
  selectedInputId,
  isGuest,
  guestInputId,
  onLayersChange,
}: LayersSectionProps) {
  const { inputs, roomId, refreshState, availableShaders } =
    useControlPanelContext();
  const {
    cameraPcRef,
    cameraStreamRef,
    activeCameraInputId,
    activeScreenshareInputId,
    setActiveCameraInputId,
    setIsCameraActive,
    setActiveScreenshareInputId,
    setIsScreenshareActive,
  } = useWhipConnectionsContext();

  const [collapsedLayers, setCollapsedLayers] = useState<Set<string>>(
    new Set(),
  );
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [activeDragItem, setActiveDragItem] = useState<DragItem | null>(null);
  const [localLayers, setLocalLayers] = useState(layers);

  useEffect(() => {
    setLocalLayers(layers);
  }, [layers]);

  const [isWideScreen, setIsWideScreen] = useState(true);
  useEffect(() => {
    const check = () => setIsWideScreen(window.innerWidth >= 1600);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const disableDrag = isGuest || !isWideScreen;

  const onWhipDisconnectedOrRemoved = useCallback(
    (id: string) => {
      if (activeCameraInputId === id) {
        setActiveCameraInputId(null);
        setIsCameraActive(false);
      }
      if (activeScreenshareInputId === id) {
        setActiveScreenshareInputId(null);
        setIsScreenshareActive(false);
      }
    },
    [
      activeCameraInputId,
      activeScreenshareInputId,
      setActiveCameraInputId,
      setIsCameraActive,
      setActiveScreenshareInputId,
      setIsScreenshareActive,
    ],
  );

  const toggleCollapse = useCallback((layerId: string) => {
    setCollapsedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  }, []);

  // Attached inputs (hidden from layer lists)
  const attachedInputIds = useMemo(() => {
    const ids = new Set<string>();
    for (const input of inputs) {
      for (const id of input.attachedInputIds || []) {
        ids.add(id);
      }
    }
    return ids;
  }, [inputs]);

  // Build sortable IDs — layers use `layer::{id}`, inputs use their inputId
  const layerIds = useMemo(
    () => localLayers.map((l) => `layer::${l.id}`),
    [localLayers],
  );

  // Find which layer/input an ID belongs to
  const findDragItem = useCallback(
    (id: UniqueIdentifier): DragItem | null => {
      const sid = String(id);
      if (sid.startsWith('layer::')) {
        return { type: 'layer', layerId: sid.slice(7) };
      }
      for (const layer of localLayers) {
        if (layer.inputs.some((i) => i.inputId === sid)) {
          return { type: 'input', layerId: layer.id, inputId: sid };
        }
      }
      return null;
    },
    [localLayers],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: disableDrag ? 999999 : 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveId(event.active.id);
      setActiveDragItem(findDragItem(event.active.id));
    },
    [findDragItem],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over || !activeDragItem) return;

      const overItem = findDragItem(over.id);
      if (!overItem) return;

      // Layer reordering
      if (activeDragItem.type === 'layer' && overItem.type === 'layer') {
        setLocalLayers((prev) => {
          const oldIdx = prev.findIndex((l) => l.id === activeDragItem.layerId);
          const newIdx = prev.findIndex((l) => l.id === overItem.layerId);
          if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return prev;
          return arrayMove(prev, oldIdx, newIdx);
        });
        return;
      }

      // Input reordering / cross-layer move
      if (activeDragItem.type === 'input') {
        const overLayerId =
          overItem.type === 'layer' ? overItem.layerId : overItem.layerId;

        setLocalLayers((prev) => {
          const srcLayerIdx = prev.findIndex(
            (l) => l.id === activeDragItem.layerId,
          );
          const dstLayerIdx = prev.findIndex((l) => l.id === overLayerId);
          if (srcLayerIdx === -1 || dstLayerIdx === -1) return prev;

          const next = prev.map((l) => ({
            ...l,
            inputs: [...l.inputs],
          }));

          const srcInputIdx = next[srcLayerIdx].inputs.findIndex(
            (i) => i.inputId === activeDragItem.inputId,
          );
          if (srcInputIdx === -1) return prev;

          if (srcLayerIdx === dstLayerIdx) {
            // Same layer reorder
            if (overItem.type === 'input' && overItem.inputId) {
              const overInputIdx = next[dstLayerIdx].inputs.findIndex(
                (i) => i.inputId === overItem.inputId,
              );
              if (overInputIdx !== -1 && srcInputIdx !== overInputIdx) {
                next[dstLayerIdx].inputs = arrayMove(
                  next[dstLayerIdx].inputs,
                  srcInputIdx,
                  overInputIdx,
                );
              }
            }
          } else {
            // Cross-layer move
            const [movedInput] = next[srcLayerIdx].inputs.splice(
              srcInputIdx,
              1,
            );
            let insertIdx = next[dstLayerIdx].inputs.length;
            if (overItem.type === 'input' && overItem.inputId) {
              const overInputIdx = next[dstLayerIdx].inputs.findIndex(
                (i) => i.inputId === overItem.inputId,
              );
              if (overInputIdx !== -1) insertIdx = overInputIdx;
            }
            next[dstLayerIdx].inputs.splice(insertIdx, 0, movedInput);
          }

          return next;
        });

        // Update drag source tracking immutably so React state is not mutated in place
        if (activeDragItem.layerId !== overLayerId) {
          setActiveDragItem((prev) =>
            prev && prev.type === 'input'
              ? { ...prev, layerId: overLayerId }
              : prev,
          );
        }
      }
    },
    [activeDragItem, findDragItem],
  );

  const handleDragEnd = useCallback(
    async (_event: DragEndEvent) => {
      setActiveId(null);
      setActiveDragItem(null);
      // Push the localLayers state to server
      await onLayersChange(localLayers);
    },
    [localLayers, onLayersChange],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setActiveDragItem(null);
    setLocalLayers(layers);
  }, [layers]);

  const handleBehaviorChange = useCallback(
    async (layerId: string, behavior: LayerBehaviorConfig | undefined) => {
      const updated = localLayers.map((l) =>
        l.id === layerId ? { ...l, behavior } : l,
      );
      setLocalLayers(updated);
      await onLayersChange(updated);
    },
    [localLayers, onLayersChange],
  );

  // Active drag overlay content
  const activeInput = useMemo(() => {
    if (!activeDragItem || activeDragItem.type !== 'input') return null;
    return inputs.find((i) => i.inputId === activeDragItem.inputId) ?? null;
  }, [activeDragItem, inputs]);

  const activeLayerIndex = useMemo(() => {
    if (!activeDragItem || activeDragItem.type !== 'layer') return -1;
    return localLayers.findIndex((l) => l.id === activeDragItem.layerId);
  }, [activeDragItem, localLayers]);

  if (showStreamsSpinner) {
    return (
      <div className='flex items-center justify-center h-32'>
        <LoadingSpinner size='lg' variant='spinner' />
      </div>
    );
  }

  return (
    <div className='flex-1 overflow-y-auto overflow-x-hidden relative'>
      {isSwapping && (
        <div className='absolute inset-0 z-50 flex items-center justify-center bg-black/60 rounded-md backdrop-blur-sm'>
          <div className='flex items-center gap-2 text-neutral-300 text-sm'>
            <svg
              className='animate-spin h-5 w-5'
              viewBox='0 0 24 24'
              fill='none'>
              <circle
                className='opacity-25'
                cx='12'
                cy='12'
                r='10'
                stroke='currentColor'
                strokeWidth='4'
              />
              <path
                className='opacity-75'
                fill='currentColor'
                d='M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z'
              />
            </svg>
            <span>Transitioning…</span>
          </div>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}>
        <SortableContext
          items={layerIds}
          strategy={verticalListSortingStrategy}>
          {localLayers.map((layer, layerIndex) => {
            const isCollapsed = collapsedLayers.has(layer.id);
            const visibleInputs = layer.inputs.filter(
              (i) => !attachedInputIds.has(i.inputId),
            );
            const inputIds = visibleInputs.map((i) => i.inputId);

            return (
              <SortableLayerItem
                key={layer.id}
                id={`layer::${layer.id}`}
                disabled={disableDrag}>
                <div className='border-b border-neutral-800/50'>
                  <LayerHeader
                    layerId={layer.id}
                    layerIndex={layerIndex}
                    isCollapsed={isCollapsed}
                    onToggleCollapse={() => toggleCollapse(layer.id)}
                    behavior={layer.behavior}
                    onBehaviorChange={(b) => handleBehaviorChange(layer.id, b)}
                    isGuest={isGuest}
                  />

                  {!isCollapsed && (
                    <SortableContext
                      items={inputIds}
                      strategy={verticalListSortingStrategy}>
                      <div className='min-h-[4px]'>
                        {visibleInputs.length === 0 && (
                          <div className='text-[10px] text-neutral-600 text-center py-2'>
                            Drop inputs here
                          </div>
                        )}
                        {visibleInputs.map((layerInput, inputIndex) => {
                          const input = inputs.find(
                            (i) => i.inputId === layerInput.inputId,
                          );
                          if (!input) return null;
                          const attachedChildren =
                            input.attachedInputIds
                              ?.map((id) =>
                                inputs.find((i) => i.inputId === id),
                              )
                              .filter((i): i is Input => !!i) || [];

                          return (
                            <SortableInputItem
                              key={layerInput.inputId}
                              id={layerInput.inputId}
                              disabled={disableDrag}>
                              <ErrorBoundary>
                                <InputEntry
                                  input={input}
                                  refreshState={refreshState}
                                  roomId={roomId}
                                  availableShaders={availableShaders}
                                  canRemove={
                                    isGuest
                                      ? input.inputId === guestInputId
                                      : true
                                  }
                                  canMoveUp={isGuest ? false : inputIndex > 0}
                                  canMoveDown={
                                    isGuest
                                      ? false
                                      : inputIndex < visibleInputs.length - 1
                                  }
                                  pcRef={cameraPcRef}
                                  streamRef={cameraStreamRef}
                                  isLocalWhipInput={
                                    input.inputId === activeCameraInputId ||
                                    input.inputId === activeScreenshareInputId
                                  }
                                  isFxOpen={openFxInputId === input.inputId}
                                  onToggleFx={() => onToggleFx(input.inputId)}
                                  onWhipDisconnectedOrRemoved={
                                    onWhipDisconnectedOrRemoved
                                  }
                                  showGrip={isGuest ? false : isWideScreen}
                                  isSelected={selectedInputId === input.inputId}
                                  index={inputIndex}
                                  allInputs={inputs}
                                  readOnly={
                                    isGuest && input.inputId !== guestInputId
                                  }
                                />
                              </ErrorBoundary>
                              {attachedChildren.map((child) => (
                                <div
                                  key={child.inputId}
                                  className='ml-6 mt-1 border-l-2 border-blue-500/30 pl-2'>
                                  <ErrorBoundary>
                                    <InputEntry
                                      input={child}
                                      refreshState={refreshState}
                                      roomId={roomId}
                                      availableShaders={availableShaders}
                                      canRemove={false}
                                      canMoveUp={false}
                                      canMoveDown={false}
                                      pcRef={cameraPcRef}
                                      streamRef={cameraStreamRef}
                                      isFxOpen={openFxInputId === child.inputId}
                                      onToggleFx={() =>
                                        onToggleFx(child.inputId)
                                      }
                                      onWhipDisconnectedOrRemoved={
                                        onWhipDisconnectedOrRemoved
                                      }
                                      showGrip={false}
                                      isSelected={
                                        selectedInputId === child.inputId
                                      }
                                      allInputs={inputs}
                                      readOnly={
                                        isGuest &&
                                        child.inputId !== guestInputId
                                      }
                                    />
                                  </ErrorBoundary>
                                </div>
                              ))}
                            </SortableInputItem>
                          );
                        })}
                      </div>
                    </SortableContext>
                  )}
                </div>
              </SortableLayerItem>
            );
          })}
        </SortableContext>

        <DragOverlay dropAnimation={dropAnimation}>
          {activeId && activeDragItem?.type === 'layer' && (
            <div className='bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-[11px] text-neutral-300 shadow-lg'>
              Layer {activeLayerIndex + 1}
            </div>
          )}
          {activeId && activeDragItem?.type === 'input' && activeInput && (
            <div className='bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-[11px] text-neutral-300 shadow-lg truncate max-w-[200px]'>
              {activeInput.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
