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
import { useState } from 'react';
import { useIsMobileDevice } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { SwitchCamera } from 'lucide-react';

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

  const isMobileDevice = useIsMobileDevice();
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

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
        isMobileDevice ? facingMode : undefined,
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
    <div className='flex flex-col gap-2'>
      {isMobileDevice && (
        <div className='flex items-center gap-2 px-1'>
          <span className='text-sm text-neutral-400'>Camera:</span>
          <div className='flex rounded-md overflow-hidden border border-neutral-700'>
            <Button
              size='sm'
              variant='ghost'
              type='button'
              onClick={() => setFacingMode('user')}
              className={`cursor-pointer rounded-none text-xs px-3 ${
                facingMode === 'user'
                  ? 'bg-neutral-700 text-white'
                  : 'text-neutral-500'
              }`}>
              Front
            </Button>
            <Button
              size='sm'
              variant='ghost'
              type='button'
              onClick={() => setFacingMode('environment')}
              className={`cursor-pointer rounded-none text-xs px-3 ${
                facingMode === 'environment'
                  ? 'bg-neutral-700 text-white'
                  : 'text-neutral-500'
              }`}>
              <SwitchCamera className='w-3.5 h-3.5' />
              Back
            </Button>
          </div>
        </div>
      )}
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
    </div>
  );
}
