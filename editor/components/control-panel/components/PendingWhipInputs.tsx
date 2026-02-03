'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import { Video, Monitor, X } from 'lucide-react';
import {
  addCameraInput,
  updateInput,
  updateRoom,
  getRoomInfo,
} from '@/app/actions/actions';
import { startPublish } from '../whip-input/utils/whip-publisher';
import { startScreensharePublish } from '../whip-input/utils/screenshare-publisher';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import {
  saveWhipSession,
  saveLastWhipInputId,
} from '../whip-input/utils/whip-storage';
import { toast } from 'react-toastify';
import type { PendingWhipInput } from './ConfigurationSection';

type PendingWhipInputsProps = {
  roomId: string;
  pendingInputs: PendingWhipInput[];
  setPendingInputs: React.Dispatch<React.SetStateAction<PendingWhipInput[]>>;
  refreshState: () => Promise<void>;
  cameraPcRef: React.MutableRefObject<RTCPeerConnection | null>;
  cameraStreamRef: React.MutableRefObject<MediaStream | null>;
  screensharePcRef: React.MutableRefObject<RTCPeerConnection | null>;
  screenshareStreamRef: React.MutableRefObject<MediaStream | null>;
  setActiveCameraInputId: (id: string | null) => void;
  setIsCameraActive: (active: boolean) => void;
  setActiveScreenshareInputId: (id: string | null) => void;
  setIsScreenshareActive: (active: boolean) => void;
};

export function PendingWhipInputs({
  roomId,
  pendingInputs,
  setPendingInputs,
  refreshState,
  cameraPcRef,
  cameraStreamRef,
  screensharePcRef,
  screenshareStreamRef,
  setActiveCameraInputId,
  setIsCameraActive,
  setActiveScreenshareInputId,
  setIsScreenshareActive,
}: PendingWhipInputsProps) {
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectType, setConnectType] = useState<
    'camera' | 'screenshare' | null
  >(null);

  if (pendingInputs.length === 0) return null;

  const handleConnect = async (
    pendingInput: PendingWhipInput,
    type: 'camera' | 'screenshare',
  ) => {
    setConnectingId(pendingInput.id);
    setConnectType(type);

    const pcRef = type === 'camera' ? cameraPcRef : screensharePcRef;
    const streamRef =
      type === 'camera' ? cameraStreamRef : screenshareStreamRef;
    const setActiveInputId =
      type === 'camera' ? setActiveCameraInputId : setActiveScreenshareInputId;
    const setIsActive =
      type === 'camera' ? setIsCameraActive : setIsScreenshareActive;
    const publishFn =
      type === 'camera' ? startPublish : startScreensharePublish;

    try {
      const response = await addCameraInput(roomId, pendingInput.title);
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

      if (pendingInput.config.shaders.length > 0) {
        await updateInput(roomId, response.inputId, {
          volume: pendingInput.config.volume,
          shaders: pendingInput.config.shaders,
          showTitle: pendingInput.config.showTitle,
        });
      }

      const roomInfo = await getRoomInfo(roomId);
      if (roomInfo !== 'not-found') {
        const currentInputIds = roomInfo.inputs.map((i) => i.inputId);
        const newInputId = response.inputId;
        const targetPosition = pendingInput.position;

        const withoutNew = currentInputIds.filter((id) => id !== newInputId);
        const reordered = [
          ...withoutNew.slice(0, targetPosition),
          newInputId,
          ...withoutNew.slice(targetPosition),
        ];

        await updateRoom(roomId, { inputOrder: reordered });
      }

      setPendingInputs((prev) => prev.filter((p) => p.id !== pendingInput.id));
      await refreshState();

      toast.success(
        `Connected ${type === 'camera' ? 'camera' : 'screenshare'}: ${pendingInput.title}`,
      );
    } catch (e: any) {
      console.error(`Failed to connect ${type}:`, e);
      toast.error(`Failed to connect: ${e?.message || e}`);
      stopCameraAndConnection(pcRef, streamRef);
      setActiveInputId(null);
      setIsActive(false);
    } finally {
      setConnectingId(null);
      setConnectType(null);
    }
  };

  const handleDismiss = (pendingInput: PendingWhipInput) => {
    setPendingInputs((prev) => prev.filter((p) => p.id !== pendingInput.id));
  };

  return (
    <div className='flex flex-col gap-2 mb-3'>
      <div className='text-xs text-neutral-400 uppercase tracking-wide px-1'>
        Pending Connections
      </div>
      {pendingInputs.map((pendingInput) => (
        <div
          key={pendingInput.id}
          className='p-3 bg-neutral-900 border-2 border-dashed border-neutral-700 rounded-none'>
          <div className='flex items-center justify-between mb-2'>
            <span className='text-sm text-white font-medium truncate'>
              {pendingInput.title}
            </span>
            <button
              onClick={() => handleDismiss(pendingInput)}
              className='p-1 text-neutral-500 hover:text-white transition-colors cursor-pointer'>
              <X className='w-4 h-4' />
            </button>
          </div>
          <div className='text-xs text-neutral-500 mb-3'>
            WHIP input - click to connect
          </div>
          <div className='flex gap-2'>
            <Button
              size='sm'
              variant='default'
              className='flex-1 bg-neutral-800 hover:bg-neutral-700 text-white cursor-pointer'
              disabled={connectingId === pendingInput.id}
              onClick={() => handleConnect(pendingInput, 'camera')}>
              {connectingId === pendingInput.id && connectType === 'camera' ? (
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
              disabled={connectingId === pendingInput.id}
              onClick={() => handleConnect(pendingInput, 'screenshare')}>
              {connectingId === pendingInput.id &&
              connectType === 'screenshare' ? (
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
      ))}
    </div>
  );
}
