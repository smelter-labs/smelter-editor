import type { Input } from '@/app/actions/actions';
import { addCameraInput } from '@/app/actions/actions';
import { GenericAddInputForm } from './generic-add-input-form';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import {
  loadWhipSession,
  saveWhipSession,
  saveLastWhipInputId,
} from '../whip-input/utils/whip-storage';
import { startScreensharePublish } from '../whip-input/utils/screenshare-publisher';
import { toast } from 'react-toastify';
import type React from 'react';

export function ScreenshareAddInputForm(props: {
  inputs: Input[];
  roomId: string;
  refreshState: () => Promise<void>;
  userName: string;
  setUserName: (name: string) => void;
  pcRef: React.MutableRefObject<RTCPeerConnection | null>;
  streamRef: React.MutableRefObject<MediaStream | null>;
  setActiveWhipInputId: (id: string | null) => void;
  setIsWhipActive: (active: boolean) => void;
}) {
  const {
    inputs,
    roomId,
    refreshState,
    userName,
    setUserName,
    pcRef,
    streamRef,
    setActiveWhipInputId,
    setIsWhipActive,
  } = props;

  const handleAddScreenshare = async (whipUserName: string) => {
    const cleanedName = whipUserName.trim();
    if (!cleanedName) {
      toast.error('Please enter a username.');
      throw new Error('Please enter a username.');
    }
    try {
      const s = loadWhipSession();
      const response = await addCameraInput(roomId, cleanedName);

      setActiveWhipInputId(response.inputId);
      setIsWhipActive(false);

      const onDisconnected = () => {
        stopCameraAndConnection(pcRef, streamRef);
        setIsWhipActive(false);
      };

      const { location } = await startScreensharePublish(
        response.inputId,
        response.bearerToken,
        response.whipUrl,
        pcRef,
        streamRef,
        onDisconnected,
      );

      setIsWhipActive(true);

      saveWhipSession({
        roomId,
        inputId: response.inputId,
        bearerToken: response.bearerToken,
        location,
        ts: Date.now(),
      });
      saveLastWhipInputId(roomId, response.inputId);
    } catch (e: any) {
      console.error('Screenshare add failed:', e);
      toast.error(`Failed to add screenshare: ${e?.message || e}`);
      stopCameraAndConnection(pcRef, streamRef);
      setActiveWhipInputId(null);
      setIsWhipActive(false);
      throw e;
    }
  };

  return (
    <GenericAddInputForm<string>
      showArrow={false}
      forceShowButton
      inputs={inputs}
      refreshState={refreshState}
      suggestions={[]}
      placeholder='Enter a username (e.g. John Smith)'
      initialValue={userName
        .replace(/^Camera\s+/i, 'Screenshare ')
        .replace(/^User\s+/i, 'Screenshare ')}
      onSubmit={async (whipUserName: string) => {
        await handleAddScreenshare(whipUserName);
        setUserName(whipUserName);
      }}
      renderSuggestion={(suggestion: string) => suggestion}
      getSuggestionValue={(v) => v}
      buttonText='Add Screenshare'
      loadingText='Adding...'
      validateInput={(value) =>
        !value ? 'Please enter a username.' : undefined
      }
    />
  );
}
