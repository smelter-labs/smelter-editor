import type { Input } from '@/app/actions/actions';
import Accordion, { type AccordionHandle } from '@/components/ui/accordion';
import TwitchAddInputForm from '../add-input-form/twitch-add-input-form';
import { Mp4AddInputForm } from '../add-input-form/mp4-add-input-form';
import { KickAddInputForm } from '../add-input-form/kick-add-input-form';
import { ImageAddInputForm } from '../add-input-form/image-add-input-form';
import { TextAddInputForm } from '../add-input-form/text-add-input-form';
import { WHIPAddInputForm } from '../add-input-form/whip-add-input-form';
import { ScreenshareAddInputForm } from '../add-input-form/screenshare-add-input-form';
import { useIsMobile } from '@/hooks/use-mobile';

export type AddTab = 'stream' | 'mp4' | 'image' | 'text' | 'inputs';
type StreamTab = 'twitch' | 'kick';
type InputsTab = 'camera' | 'screenshare';

type AddVideoSectionProps = {
  inputs: Input[];
  roomId: string;
  refreshState: () => Promise<void>;
  addInputActiveTab: AddTab;
  setAddInputActiveTab: (tab: AddTab) => void;
  streamActiveTab: StreamTab;
  setStreamActiveTab: (tab: StreamTab) => void;
  inputsActiveTab: InputsTab;
  setInputsActiveTab: (tab: InputsTab) => void;
  userName: string;
  setUserName: (name: string) => void;
  cameraPcRef: React.MutableRefObject<RTCPeerConnection | null>;
  cameraStreamRef: React.MutableRefObject<MediaStream | null>;
  screensharePcRef: React.MutableRefObject<RTCPeerConnection | null>;
  screenshareStreamRef: React.MutableRefObject<MediaStream | null>;
  setActiveCameraInputId: (id: string | null) => void;
  setIsCameraActive: (active: boolean) => void;
  setActiveScreenshareInputId: (id: string | null) => void;
  setIsScreenshareActive: (active: boolean) => void;
  addVideoAccordionRef: React.MutableRefObject<AccordionHandle | null>;
  isGuest?: boolean;
  hasGuestInput?: boolean;
};

export function AddVideoSection({
  inputs,
  roomId,
  refreshState,
  addInputActiveTab,
  setAddInputActiveTab,
  streamActiveTab,
  setStreamActiveTab,
  inputsActiveTab,
  setInputsActiveTab,
  userName,
  setUserName,
  cameraPcRef,
  cameraStreamRef,
  screensharePcRef,
  screenshareStreamRef,
  setActiveCameraInputId,
  setIsCameraActive,
  setActiveScreenshareInputId,
  setIsScreenshareActive,
  addVideoAccordionRef,
  isGuest,
  hasGuestInput,
}: AddVideoSectionProps) {
  const isMobile = useIsMobile();

  if (isGuest && hasGuestInput) {
    return null;
  }

  const tabs: { id: AddTab; label: string }[] = isGuest
    ? [{ id: 'inputs', label: 'Connect Input' }]
    : [
        { id: 'stream', label: 'Stream' },
        { id: 'mp4', label: 'MP4' },
        { id: 'image', label: 'Image' },
        { id: 'text', label: 'Text' },
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
                className={`py-2 px-2 md:px-3 -mb-[1px] cursor-pointer text-base font-bold transition-colors ${
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
