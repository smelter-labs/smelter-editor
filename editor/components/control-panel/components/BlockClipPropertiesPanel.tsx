'use client';

import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Input, AvailableShader } from '@/app/actions/actions';
import {
  updateInput as updateInputAction,
  addCameraInput,
} from '@/app/actions/actions';
import ShaderPanel from '../input-entry/shader-panel';
import { AddShaderModal } from '../input-entry/add-shader-modal';
import type { BlockSettings } from '../hooks/use-timeline-state';
import { Link, Video, Monitor } from 'lucide-react';
import { startPublish } from '../whip-input/utils/whip-publisher';
import { startScreensharePublish } from '../whip-input/utils/screenshare-publisher';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import {
  saveWhipSession,
  saveLastWhipInputId,
} from '../whip-input/utils/whip-storage';
import { updateTimelineInputId } from '@/lib/room-config';
import { useWhipConnectionsContext } from '../contexts/whip-connections-context';
import { useControlPanelContext } from '../contexts/control-panel-context';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import { toast } from 'react-toastify';

export type SelectedTimelineClip = {
  trackId: string;
  clipId: string;
  inputId: string;
  startMs: number;
  endMs: number;
  blockSettings: BlockSettings;
};

export function BlockClipPropertiesPanel({
  roomId,
  selectedTimelineClip,
  onSelectedTimelineClipChange,
  inputs,
  availableShaders,
  handleRefreshState,
}: {
  roomId: string;
  selectedTimelineClip: SelectedTimelineClip | null;
  onSelectedTimelineClipChange: (clip: SelectedTimelineClip | null) => void;
  inputs: Input[];
  availableShaders: AvailableShader[];
  handleRefreshState: () => Promise<void>;
}) {
  const [sliderValues, setSliderValues] = useState<{ [key: string]: number }>(
    {},
  );
  const [shaderLoading, setShaderLoading] = useState<string | null>(null);
  const [paramLoading, setParamLoading] = useState<{
    [shaderId: string]: string | null;
  }>({});
  const [isAddShaderModalOpen, setIsAddShaderModalOpen] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const attachBtnRef = useRef<HTMLButtonElement>(null);
  const [attachMenuPos, setAttachMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const {
    cameraPcRef,
    cameraStreamRef,
    screensharePcRef,
    screenshareStreamRef,
    setActiveCameraInputId,
    setIsCameraActive,
    setActiveScreenshareInputId,
    setIsScreenshareActive,
  } = useWhipConnectionsContext();
  const { refreshState: ctxRefreshState } = useControlPanelContext();

  const selectedInput = selectedTimelineClip
    ? inputs.find((i) => i.inputId === selectedTimelineClip.inputId)
    : null;
  const isDisconnected =
    !!selectedTimelineClip &&
    !selectedInput &&
    !selectedTimelineClip.inputId.startsWith('__pending-whip-');

  const [connectingType, setConnectingType] = useState<
    'camera' | 'screenshare' | null
  >(null);

  const handleConnectWhip = useCallback(
    async (type: 'camera' | 'screenshare') => {
      if (!selectedTimelineClip) return;
      setConnectingType(type);

      const pcRef = type === 'camera' ? cameraPcRef : screensharePcRef;
      const streamRef =
        type === 'camera' ? cameraStreamRef : screenshareStreamRef;
      const setActiveInputId =
        type === 'camera'
          ? setActiveCameraInputId
          : setActiveScreenshareInputId;
      const setIsActive =
        type === 'camera' ? setIsCameraActive : setIsScreenshareActive;
      const publishFn =
        type === 'camera' ? startPublish : startScreensharePublish;
      const oldInputId = selectedTimelineClip.inputId;

      try {
        const title =
          type === 'camera' ? `Camera-${Date.now()}` : `Screen-${Date.now()}`;
        const response = await addCameraInput(roomId, title);
        setActiveInputId(response.inputId);
        setIsActive(false);

        const onDisconnected = () => {
          stopCameraAndConnection(pcRef, streamRef);
          setIsActive(false);
        };

        const { location } = await publishFn(
          response.inputId,
          response.bearerToken,
          response.whipUrl,
          pcRef,
          streamRef,
          onDisconnected,
        );

        setIsActive(true);

        saveWhipSession({
          roomId,
          inputId: response.inputId,
          bearerToken: response.bearerToken,
          location,
          ts: Date.now(),
        });
        saveLastWhipInputId(roomId, response.inputId);

        const timelineUpdated = updateTimelineInputId(
          roomId,
          oldInputId,
          response.inputId,
        );
        if (timelineUpdated) {
          window.dispatchEvent(
            new CustomEvent('smelter:timeline-input-replaced', {
              detail: {
                oldInputId,
                newInputId: response.inputId,
              },
            }),
          );
        }

        onSelectedTimelineClipChange({
          ...selectedTimelineClip,
          inputId: response.inputId,
        });

        await handleRefreshState();
        toast.success(
          `Connected ${type === 'camera' ? 'camera' : 'screenshare'}`,
        );
      } catch (e: any) {
        console.error(`Failed to connect ${type}:`, e);
        toast.error(`Failed to connect: ${e?.message || e}`);
        stopCameraAndConnection(pcRef, streamRef);
        setActiveInputId(null);
        setIsActive(false);
      } finally {
        setConnectingType(null);
      }
    },
    [
      selectedTimelineClip,
      roomId,
      cameraPcRef,
      cameraStreamRef,
      screensharePcRef,
      screenshareStreamRef,
      setActiveCameraInputId,
      setIsCameraActive,
      setActiveScreenshareInputId,
      setIsScreenshareActive,
      handleRefreshState,
      onSelectedTimelineClipChange,
    ],
  );

  const applyClipPatch = useCallback(
    async (patch: Partial<BlockSettings>) => {
      if (!selectedTimelineClip) return;
      const nextClip: SelectedTimelineClip = {
        ...selectedTimelineClip,
        blockSettings: {
          ...selectedTimelineClip.blockSettings,
          ...patch,
        },
      };
      onSelectedTimelineClipChange(nextClip);
      window.dispatchEvent(
        new CustomEvent('smelter:timeline:update-clip-settings', {
          detail: {
            trackId: selectedTimelineClip.trackId,
            clipId: selectedTimelineClip.clipId,
            patch,
          },
        }),
      );

      try {
        await updateInputAction(roomId, selectedTimelineClip.inputId, {
          volume: patch.volume ?? nextClip.blockSettings.volume,
          shaders: patch.shaders ?? nextClip.blockSettings.shaders,
          showTitle: patch.showTitle ?? nextClip.blockSettings.showTitle,
          orientation: patch.orientation ?? nextClip.blockSettings.orientation,
          text: patch.text,
          textAlign: patch.textAlign,
          textColor: patch.textColor,
          textMaxLines: patch.textMaxLines,
          textScrollSpeed: patch.textScrollSpeed,
          textScrollLoop: patch.textScrollLoop,
          textFontSize: patch.textFontSize,
          borderColor: patch.borderColor,
          borderWidth: patch.borderWidth,
          attachedInputIds: patch.attachedInputIds,
        });
        await handleRefreshState();
      } catch (err) {
        console.warn('Failed to apply clip settings', err);
      }
    },
    [
      selectedTimelineClip,
      onSelectedTimelineClipChange,
      roomId,
      handleRefreshState,
    ],
  );

  const handleShaderToggle = useCallback(
    (shaderId: string) => {
      if (!selectedTimelineClip) return;
      const current = selectedTimelineClip.blockSettings.shaders || [];
      const existing = current.find((s) => s.shaderId === shaderId);
      if (!existing) {
        const shaderDef = availableShaders.find((s) => s.id === shaderId);
        if (!shaderDef) return;
        void applyClipPatch({
          shaders: [
            ...current,
            {
              shaderName: shaderDef.name,
              shaderId: shaderDef.id,
              enabled: true,
              params:
                shaderDef.params?.map((param) => ({
                  paramName: param.name,
                  paramValue:
                    typeof param.defaultValue === 'number'
                      ? param.defaultValue
                      : 0,
                })) || [],
            },
          ],
        });
        return;
      }
      void applyClipPatch({
        shaders: current.map((shader) =>
          shader.shaderId === shaderId
            ? { ...shader, enabled: !shader.enabled }
            : shader,
        ),
      });
    },
    [selectedTimelineClip, availableShaders, applyClipPatch],
  );

  const handleShaderRemove = useCallback(
    (shaderId: string) => {
      if (!selectedTimelineClip) return;
      void applyClipPatch({
        shaders: (selectedTimelineClip.blockSettings.shaders || []).filter(
          (shader) => shader.shaderId !== shaderId,
        ),
      });
    },
    [selectedTimelineClip, applyClipPatch],
  );

  const handleSliderChange = useCallback(
    (shaderId: string, paramName: string, newValue: number) => {
      if (!selectedTimelineClip) return;
      setSliderValues((prev) => ({
        ...prev,
        [`${shaderId}:${paramName}`]: newValue,
      }));
      setParamLoading((prev) => ({ ...prev, [shaderId]: paramName }));
      const current = selectedTimelineClip.blockSettings.shaders || [];
      const shaders = current.map((shader) => {
        if (shader.shaderId !== shaderId) return shader;
        return {
          ...shader,
          params: shader.params.map((param) =>
            param.paramName === paramName
              ? { ...param, paramValue: newValue }
              : param,
          ),
        };
      });
      void applyClipPatch({ shaders }).finally(() =>
        setParamLoading((prev) => ({ ...prev, [shaderId]: null })),
      );
    },
    [selectedTimelineClip, applyClipPatch],
  );

  const getShaderParamConfig = useCallback(
    (shaderId: string, paramName: string) =>
      selectedTimelineClip?.blockSettings.shaders
        ?.find((shader) => shader.shaderId === shaderId)
        ?.params.find((param) => param.paramName === paramName),
    [selectedTimelineClip],
  );

  const handleAttachToggle = useCallback(
    (targetInputId: string) => {
      if (!selectedTimelineClip) return;
      const current = selectedTimelineClip.blockSettings.attachedInputIds || [];
      const newAttached = current.includes(targetInputId)
        ? current.filter((id) => id !== targetInputId)
        : [...current, targetInputId];
      void applyClipPatch({ attachedInputIds: newAttached });
    },
    [selectedTimelineClip, applyClipPatch],
  );

  if (!selectedTimelineClip) {
    return null;
  }

  const shaderInput: Input = selectedInput ?? {
    id: -1,
    inputId: selectedTimelineClip.inputId,
    title: selectedTimelineClip.inputId,
    description: '',
    showTitle: selectedTimelineClip.blockSettings.showTitle,
    volume: selectedTimelineClip.blockSettings.volume,
    type: 'local-mp4',
    sourceState: 'unknown',
    status: 'connected',
    shaders: selectedTimelineClip.blockSettings.shaders,
    orientation: selectedTimelineClip.blockSettings.orientation,
    attachedInputIds: selectedTimelineClip.blockSettings.attachedInputIds,
    borderColor: selectedTimelineClip.blockSettings.borderColor,
    borderWidth: selectedTimelineClip.blockSettings.borderWidth,
  };
  shaderInput.shaders = selectedTimelineClip.blockSettings.shaders;

  return (
    <div className='mt-3 p-3 rounded-md border border-neutral-800 bg-neutral-900'>
      <div className='text-xs text-neutral-500 mb-2'>
        Selected block properties
      </div>
      <div className='text-sm text-neutral-300 mb-3 truncate'>
        {selectedInput?.title ?? selectedTimelineClip.inputId}
      </div>
      {isDisconnected && (
        <div className='mb-3 p-2.5 rounded border-2 border-dashed border-neutral-700 bg-neutral-800/50'>
          <div className='text-xs text-amber-400/80 mb-2'>
            Disconnected — connect a new input
          </div>
          <div className='flex gap-2'>
            <Button
              size='sm'
              variant='default'
              className='flex-1 bg-neutral-800 hover:bg-neutral-700 text-white cursor-pointer'
              disabled={!!connectingType}
              onClick={() => handleConnectWhip('camera')}>
              {connectingType === 'camera' ? (
                <LoadingSpinner size='sm' variant='spinner' />
              ) : (
                <>
                  <Video className='w-4 h-4 mr-1' />
                  Camera
                </>
              )}
            </Button>
            <Button
              size='sm'
              variant='default'
              className='flex-1 bg-neutral-800 hover:bg-neutral-700 text-white cursor-pointer'
              disabled={!!connectingType}
              onClick={() => handleConnectWhip('screenshare')}>
              {connectingType === 'screenshare' ? (
                <LoadingSpinner size='sm' variant='spinner' />
              ) : (
                <>
                  <Monitor className='w-4 h-4 mr-1' />
                  Screen
                </>
              )}
            </Button>
          </div>
        </div>
      )}
      <div className='grid grid-cols-2 gap-2 mb-2'>
        <label className='text-xs text-neutral-400'>Volume</label>
        <input
          type='range'
          min={0}
          max={1}
          step={0.01}
          value={selectedTimelineClip.blockSettings.volume}
          onChange={(e) => {
            void applyClipPatch({ volume: Number(e.target.value) });
          }}
        />
      </div>
      <div className='flex items-center justify-between mb-2'>
        <span className='text-xs text-neutral-400'>Show title</span>
        <input
          type='checkbox'
          checked={selectedTimelineClip.blockSettings.showTitle}
          onChange={(e) => {
            void applyClipPatch({ showTitle: e.target.checked });
          }}
        />
      </div>
      <div className='flex items-center justify-between mb-2'>
        <span className='text-xs text-neutral-400'>Orientation</span>
        <select
          className='bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
          value={selectedTimelineClip.blockSettings.orientation}
          onChange={(e) =>
            void applyClipPatch({
              orientation: e.target.value as 'horizontal' | 'vertical',
            })
          }>
          <option value='horizontal'>Horizontal</option>
          <option value='vertical'>Vertical</option>
        </select>
      </div>
      <div className='grid grid-cols-2 gap-2 mb-2'>
        <div>
          <label className='text-xs text-neutral-400 block mb-1'>
            Border color
          </label>
          <input
            type='color'
            className='w-full h-8 bg-neutral-800 border border-neutral-700'
            value={selectedTimelineClip.blockSettings.borderColor || '#ff0000'}
            onChange={(e) =>
              void applyClipPatch({ borderColor: e.target.value })
            }
          />
        </div>
        <div>
          <label className='text-xs text-neutral-400 block mb-1'>
            Border width
          </label>
          <input
            type='number'
            min={0}
            max={100}
            className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
            value={selectedTimelineClip.blockSettings.borderWidth ?? 0}
            onChange={(e) =>
              void applyClipPatch({
                borderWidth: Math.max(0, Number(e.target.value) || 0),
              })
            }
          />
        </div>
      </div>
      <div className='flex items-center justify-between mb-2'>
        <span className='text-xs text-neutral-400'>Attached inputs</span>
        <button
          ref={attachBtnRef}
          className='flex items-center gap-1 text-xs px-2 py-1 rounded border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 cursor-pointer transition-colors'
          onClick={() => {
            if (!showAttachMenu && attachBtnRef.current) {
              const rect = attachBtnRef.current.getBoundingClientRect();
              setAttachMenuPos({ top: rect.bottom + 4, left: rect.left });
            }
            setShowAttachMenu(!showAttachMenu);
          }}>
          <Link
            className={`w-3.5 h-3.5 ${(selectedTimelineClip.blockSettings.attachedInputIds?.length ?? 0) > 0 ? 'text-blue-400' : 'text-neutral-400'}`}
          />
          <span className='text-neutral-300'>
            {(selectedTimelineClip.blockSettings.attachedInputIds?.length ??
              0) > 0
              ? `${selectedTimelineClip.blockSettings.attachedInputIds!.length} attached`
              : 'None'}
          </span>
        </button>
        {showAttachMenu &&
          attachMenuPos &&
          createPortal(
            <>
              <div
                className='fixed inset-0 z-[99]'
                onClick={() => setShowAttachMenu(false)}
              />
              <div
                className='fixed bg-neutral-800 border border-neutral-700 rounded-lg shadow-lg p-2 z-[100] min-w-48'
                style={{
                  top: attachMenuPos.top,
                  left: attachMenuPos.left,
                }}>
                <div className='text-xs text-neutral-400 mb-1 px-1'>
                  Attach inputs (render behind)
                </div>
                {inputs
                  .filter((i) => i.inputId !== selectedTimelineClip.inputId)
                  .filter(
                    (i) =>
                      !inputs.some(
                        (other) =>
                          other.inputId !== selectedTimelineClip.inputId &&
                          (other.attachedInputIds || []).includes(i.inputId),
                      ),
                  )
                  .map((i) => {
                    const isAttached = (
                      selectedTimelineClip.blockSettings.attachedInputIds || []
                    ).includes(i.inputId);
                    return (
                      <label
                        key={i.inputId}
                        className='flex items-center gap-2 px-1 py-1 hover:bg-neutral-700 rounded cursor-pointer'>
                        <input
                          type='checkbox'
                          checked={isAttached}
                          onChange={() => handleAttachToggle(i.inputId)}
                          className='accent-blue-500 cursor-pointer'
                        />
                        <span className='text-sm text-white truncate'>
                          {i.title}
                        </span>
                      </label>
                    );
                  })}
              </div>
            </>,
            document.body,
          )}
      </div>
      {selectedInput?.type === 'text-input' && (
        <div className='mt-2 space-y-2'>
          <div>
            <label className='text-xs text-neutral-400 block mb-1'>Text</label>
            <textarea
              className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs p-2 min-h-[80px]'
              value={selectedTimelineClip.blockSettings.text || ''}
              onChange={(e) => void applyClipPatch({ text: e.target.value })}
            />
          </div>
          <div className='grid grid-cols-2 gap-2'>
            <div>
              <label className='text-xs text-neutral-400 block mb-1'>
                Align
              </label>
              <select
                className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
                value={selectedTimelineClip.blockSettings.textAlign || 'left'}
                onChange={(e) =>
                  void applyClipPatch({
                    textAlign: e.target.value as 'left' | 'center' | 'right',
                  })
                }>
                <option value='left'>Left</option>
                <option value='center'>Center</option>
                <option value='right'>Right</option>
              </select>
            </div>
            <div>
              <label className='text-xs text-neutral-400 block mb-1'>
                Text color
              </label>
              <input
                type='color'
                className='w-full h-8 bg-neutral-800 border border-neutral-700'
                value={
                  selectedTimelineClip.blockSettings.textColor || '#ffffff'
                }
                onChange={(e) =>
                  void applyClipPatch({ textColor: e.target.value })
                }
              />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-2'>
            <div>
              <label className='text-xs text-neutral-400 block mb-1'>
                Font size
              </label>
              <input
                type='number'
                min={8}
                max={300}
                className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
                value={selectedTimelineClip.blockSettings.textFontSize ?? 80}
                onChange={(e) =>
                  void applyClipPatch({
                    textFontSize: Number(e.target.value) || 80,
                  })
                }
              />
            </div>
            <div>
              <label className='text-xs text-neutral-400 block mb-1'>
                Max lines
              </label>
              <input
                type='number'
                min={1}
                max={50}
                className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
                value={selectedTimelineClip.blockSettings.textMaxLines ?? 10}
                onChange={(e) =>
                  void applyClipPatch({
                    textMaxLines: Number(e.target.value) || 10,
                  })
                }
              />
            </div>
          </div>
          <div>
            <label className='text-xs text-neutral-400 block mb-1'>
              Scroll speed
            </label>
            <input
              type='range'
              min={1}
              max={400}
              step={1}
              value={selectedTimelineClip.blockSettings.textScrollSpeed ?? 40}
              onChange={(e) =>
                void applyClipPatch({
                  textScrollSpeed: Number(e.target.value) || 40,
                })
              }
            />
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-xs text-neutral-400'>Scroll loop</span>
            <input
              type='checkbox'
              checked={
                selectedTimelineClip.blockSettings.textScrollLoop ?? true
              }
              onChange={(e) =>
                void applyClipPatch({ textScrollLoop: e.target.checked })
              }
            />
          </div>
        </div>
      )}
      <div className='mt-3 border-t border-neutral-800 pt-2'>
        <div className='text-xs text-neutral-400 mb-1'>
          Shaders (block-level)
        </div>
        <div className='text-[11px] text-neutral-500 mb-2'>
          Edit this block's shaders independently from other blocks.
        </div>
        <ShaderPanel
          input={shaderInput}
          availableShaders={availableShaders}
          sliderValues={sliderValues}
          paramLoading={paramLoading}
          shaderLoading={shaderLoading}
          onShaderToggle={handleShaderToggle}
          onShaderRemove={handleShaderRemove}
          onSliderChange={handleSliderChange}
          getShaderParamConfig={getShaderParamConfig}
          onOpenAddShader={() => setIsAddShaderModalOpen(true)}
        />
      </div>
      <AddShaderModal
        isOpen={isAddShaderModalOpen}
        onClose={() => setIsAddShaderModalOpen(false)}
        availableShaders={availableShaders}
        addedShaderIds={
          new Set(
            (selectedTimelineClip.blockSettings.shaders || []).map(
              (s) => s.shaderId,
            ),
          )
        }
        onAddShader={handleShaderToggle}
      />
    </div>
  );
}
