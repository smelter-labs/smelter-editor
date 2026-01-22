import type { Input } from '@/app/actions/actions';
import { addCameraInput } from '@/app/actions/actions';
import { GenericAddInputForm } from './generic-add-input-form';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import {
  loadWhipSession,
  saveWhipSession,
  saveLastWhipInputId,
} from '../whip-input/utils/whip-storage';
import { startPublish } from '../whip-input/utils/whip-publisher';
import { toast } from 'react-toastify';
import type React from 'react';

export function WHIPAddInputForm(props: {
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

  const handleAddWhip = async (whipUserName: string) => {
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

      const { location } = await startPublish(
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
      console.error('WHIP add failed:', e);
      toast.error(`Failed to add WHIP input: ${e?.message || e}`);
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
      initialValue={userName}
      onSubmit={async (whipUserName: string) => {
        await handleAddWhip(whipUserName);
        setUserName(whipUserName);
      }}
      renderSuggestion={(suggestion: string) => suggestion}
      getSuggestionValue={(v) => v}
      buttonText='Add Camera'
      loadingText='Adding...'
      validateInput={(value) =>
        !value ? 'Please enter a username.' : undefined
      }
    />
  );
}
