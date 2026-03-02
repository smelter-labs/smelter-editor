import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import type { AccordionHandle } from '@/components/ui/accordion';
import Accordion from '@/components/ui/accordion';
import TwitchAddInputForm from '../add-input-form/twitch-add-input-form';
import { Mp4AddInputForm } from '../add-input-form/mp4-add-input-form';
import { KickAddInputForm } from '../add-input-form/kick-add-input-form';
import { ImageAddInputForm } from '../add-input-form/image-add-input-form';
import { TextAddInputForm } from '../add-input-form/text-add-input-form';
import { WHIPAddInputForm } from '../add-input-form/whip-add-input-form';
import { ScreenshareAddInputForm } from '../add-input-form/screenshare-add-input-form';
import { GameAddInputForm } from '../add-input-form/game-add-input-form';
import { useIsMobile } from '@/hooks/use-mobile';
import { useControlPanelContext } from '../contexts/control-panel-context';
import { useWhipConnectionsContext } from '../contexts/whip-connections-context';
import {
  loadUserName,
  saveUserName,
  clearWhipSessionFor,
  loadLastWhipInputId,
} from '../whip-input/utils/whip-storage';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import { removeInput } from '@/app/actions/actions';
import { Button } from '@/components/ui/button';
import { PhoneOff } from 'lucide-react';

export type AddTab = 'stream' | 'mp4' | 'image' | 'text' | 'game' | 'inputs';
type StreamTab = 'twitch' | 'kick';
type InputsTab = 'camera' | 'screenshare';

type AddVideoSectionProps = {
  addVideoAccordionRef: React.MutableRefObject<AccordionHandle | null>;
  isGuest?: boolean;
  hasGuestInput?: boolean;
};

export function AddVideoSection({
  addVideoAccordionRef,
  isGuest,
  hasGuestInput,
}: AddVideoSectionProps) {
  const { roomId, inputs, refreshState } = useControlPanelContext();
  const {
    cameraPcRef,
    cameraStreamRef,
    screensharePcRef,
    screenshareStreamRef,
    activeCameraInputId,
    setActiveCameraInputId,
    setIsCameraActive,
    activeScreenshareInputId,
    setActiveScreenshareInputId,
    setIsScreenshareActive,
  } = useWhipConnectionsContext();

  const isMobile = useIsMobile();
  const pathname = usePathname();
  const isKick = pathname?.toLowerCase().includes('kick');

  const [addInputActiveTab, setAddInputActiveTab] = useState<AddTab>('stream');
  const [streamActiveTab, setStreamActiveTab] = useState<StreamTab>(
    isKick ? 'kick' : 'twitch',
  );
  const [inputsActiveTab, setInputsActiveTab] = useState<InputsTab>('camera');

  const [userName, setUserName] = useState<string>(() => {
    const saved = loadUserName(roomId);
    if (saved) return saved;
    if (typeof window !== 'undefined') {
      const storedName = localStorage.getItem('smelter-display-name');
      if (storedName) return `${storedName} Camera`;
    }
    const random = Math.floor(1000 + Math.random() * 9000);
    return `User ${random}`;
  });

  useEffect(() => {
    saveUserName(roomId, userName);
  }, [roomId, userName]);

  useEffect(() => {
    const onSetAddTab = (e: CustomEvent<{ tab: AddTab }>) => {
      setAddInputActiveTab(e.detail.tab);
    };
    const onSetStreamTab = (e: CustomEvent<{ tab: StreamTab }>) => {
      setStreamActiveTab(e.detail.tab);
    };

    window.addEventListener(
      'smelter:voice:set-add-tab',
      onSetAddTab as unknown as EventListener,
    );
    window.addEventListener(
      'smelter:voice:set-stream-tab',
      onSetStreamTab as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:set-add-tab',
        onSetAddTab as unknown as EventListener,
      );
      window.removeEventListener(
        'smelter:voice:set-stream-tab',
        onSetStreamTab as unknown as EventListener,
      );
    };
  }, []);

  const guestInputId =
    activeCameraInputId ||
    activeScreenshareInputId ||
    loadLastWhipInputId(roomId);
  const guestPcRef = activeCameraInputId ? cameraPcRef : screensharePcRef;
  const guestStreamRef = activeCameraInputId
    ? cameraStreamRef
    : screenshareStreamRef;

  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleGuestDisconnect = useCallback(async () => {
    if (!guestInputId) return;
    setIsDisconnecting(true);
    try {
      stopCameraAndConnection(guestPcRef, guestStreamRef);
      clearWhipSessionFor(roomId, guestInputId);
      if (activeCameraInputId) {
        setActiveCameraInputId(null);
        setIsCameraActive(false);
      }
      if (activeScreenshareInputId) {
        setActiveScreenshareInputId(null);
        setIsScreenshareActive(false);
      }
      await removeInput(roomId, guestInputId);
      await refreshState();
    } catch (e) {
      console.error('Guest disconnect failed:', e);
    } finally {
      setIsDisconnecting(false);
    }
  }, [
    guestInputId,
    guestPcRef,
    guestStreamRef,
    roomId,
    activeCameraInputId,
    activeScreenshareInputId,
    setActiveCameraInputId,
    setIsCameraActive,
    setActiveScreenshareInputId,
    setIsScreenshareActive,
    refreshState,
  ]);

  if (isGuest && hasGuestInput) {
    return (
      <Accordion title='Connected' defaultOpen>
        <div className='flex flex-col items-center gap-3 py-2'>
          <p className='text-sm text-neutral-400'>Your input is connected</p>
          <Button
            variant='destructive'
            size='sm'
            onClick={handleGuestDisconnect}
            disabled={isDisconnecting}
            className='cursor-pointer'>
            <PhoneOff className='w-4 h-4 mr-1' />
            {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        </div>
      </Accordion>
    );
  }

  const tabs: { id: AddTab; label: string }[] = isGuest
    ? [{ id: 'inputs', label: 'Connect Input' }]
    : [
        { id: 'stream', label: 'Stream' },
        { id: 'mp4', label: 'MP4' },
        { id: 'image', label: 'Image' },
        { id: 'text', label: 'Text' },
        { id: 'game', label: 'Game' },
        { id: 'inputs', label: 'Inputs' },
      ];

  const effectiveActiveTab = isGuest ? 'inputs' : addInputActiveTab;

  return (
    <Accordion
      ref={addVideoAccordionRef}
      title={isGuest ? 'Connect Your Input' : 'Add Video'}
      defaultOpen
      data-accordion='true'>
      <div className=''>
        <div className='flex gap-2 sm:gap-3 md:gap-4 lg:gap-4 xl:gap-4 2xl:gap-5 border-b border-neutral-800 -mx-4 px-4 justify-center'>
          {tabs.map((t) => {
            const isActive = effectiveActiveTab === t.id;
            return (
              <button
                key={t.id}
                className={`py-2 px-2 md:px-3 -mb-[1px] cursor-pointer text-sm font-bold transition-colors ${
                  isActive
                    ? 'border-b-[3px] border-white text-white'
                    : 'border-b-[3px] border-transparent text-neutral-400 hover:text-white'
                }`}
                onClick={() => setAddInputActiveTab(t.id)}>
                {t.label}
              </button>
            );
          })}
        </div>
        <div className='pt-3'>
          {effectiveActiveTab === 'stream' && (
            <div>
              <div className='flex gap-2 sm:gap-3 md:gap-4 lg:gap-4 xl:gap-4 2xl:gap-5 border-b border-neutral-800 -mx-4 px-4 mb-3 justify-center'>
                <button
                  className={`py-2 px-2 md:px-3 -mb-[1px] cursor-pointer text-sm font-bold transition-colors ${
                    streamActiveTab === 'twitch'
                      ? 'border-b-[3px] border-white text-white'
                      : 'border-b-[3px] border-transparent text-neutral-400 hover:text-white'
                  }`}
                  onClick={() => setStreamActiveTab('twitch')}>
                  Twitch
                </button>
                <button
                  className={`py-2 px-2 md:px-3 -mb-[1px] cursor-pointer text-sm font-bold transition-colors ${
                    streamActiveTab === 'kick'
                      ? 'border-b-[3px] border-white text-white'
                      : 'border-b-[3px] border-transparent text-neutral-400 hover:text-white'
                  }`}
                  onClick={() => setStreamActiveTab('kick')}>
                  Kick
                </button>
              </div>
              {streamActiveTab === 'twitch' && (
                <div>
                  <TwitchAddInputForm
                    inputs={inputs}
                    roomId={roomId}
                    refreshState={refreshState}
                  />
                </div>
              )}
              {streamActiveTab === 'kick' && (
                <div>
                  <KickAddInputForm
                    inputs={inputs}
                    roomId={roomId}
                    refreshState={refreshState}
                  />
                </div>
              )}
            </div>
          )}
          {effectiveActiveTab === 'mp4' && (
            <div>
              <Mp4AddInputForm
                inputs={inputs}
                roomId={roomId}
                refreshState={refreshState}
              />
            </div>
          )}
          {effectiveActiveTab === 'image' && (
            <div>
              <ImageAddInputForm
                inputs={inputs}
                roomId={roomId}
                refreshState={refreshState}
              />
            </div>
          )}
          {effectiveActiveTab === 'text' && (
            <div>
              <TextAddInputForm
                inputs={inputs}
                roomId={roomId}
                refreshState={refreshState}
              />
            </div>
          )}
          {effectiveActiveTab === 'game' && (
            <div>
              <GameAddInputForm
                inputs={inputs}
                roomId={roomId}
                refreshState={refreshState}
              />
            </div>
          )}
          {effectiveActiveTab === 'inputs' && (
            <div>
              {!isMobile && (
                <div className='flex gap-2 sm:gap-3 md:gap-4 lg:gap-4 xl:gap-4 2xl:gap-5 border-b border-neutral-800 -mx-4 px-4 mb-3 justify-center'>
                  <button
                    className={`py-2 px-2 md:px-3 -mb-[1px] cursor-pointer text-sm font-bold transition-colors ${
                      inputsActiveTab === 'camera'
                        ? 'border-b-[3px] border-white text-white'
                        : 'border-b-[3px] border-transparent text-neutral-400 hover:text-white'
                    }`}
                    onClick={() => setInputsActiveTab('camera')}>
                    Camera
                  </button>
                  <button
                    className={`py-2 px-2 md:px-3 -mb-[1px] cursor-pointer text-sm font-bold transition-colors ${
                      inputsActiveTab === 'screenshare'
                        ? 'border-b-[3px] border-white text-white'
                        : 'border-b-[3px] border-transparent text-neutral-400 hover:text-white'
                    }`}
                    onClick={() => setInputsActiveTab('screenshare')}>
                    Screenshare
                  </button>
                </div>
              )}
              {(isMobile || inputsActiveTab === 'camera') && (
                <WHIPAddInputForm
                  inputs={inputs}
                  roomId={roomId}
                  refreshState={refreshState}
                  userName={userName}
                  setUserName={setUserName}
                  pcRef={cameraPcRef}
                  streamRef={cameraStreamRef}
                  setActiveWhipInputId={setActiveCameraInputId}
                  setIsWhipActive={setIsCameraActive}
                />
              )}
              {!isMobile && inputsActiveTab === 'screenshare' && (
                <ScreenshareAddInputForm
                  inputs={inputs}
                  roomId={roomId}
                  refreshState={refreshState}
                  userName={userName}
                  setUserName={setUserName}
                  pcRef={screensharePcRef}
                  streamRef={screenshareStreamRef}
                  setActiveWhipInputId={setActiveScreenshareInputId}
                  setIsWhipActive={setIsScreenshareActive}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </Accordion>
  );
}
