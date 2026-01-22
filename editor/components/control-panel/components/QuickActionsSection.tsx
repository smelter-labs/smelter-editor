import { useState } from 'react';
import type { Input } from '@/app/actions/actions';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import Accordion from '@/components/ui/accordion';
import {
  getPictureSuggestions,
  getMP4Suggestions,
  addImageInput,
  addMP4Input,
  removeInput,
} from '@/app/actions/actions';

type QuickActionsSectionProps = {
  inputs: Input[];
  roomId: string;
  refreshState: () => Promise<void>;
};

export function QuickActionsSection({
  inputs,
  roomId,
  refreshState,
}: QuickActionsSectionProps) {
  const [loadingActions, setLoadingActions] = useState<{
    addLogos: boolean;
    addTeam: boolean;
    removeAll: boolean;
  }>({
    addLogos: false,
    addTeam: false,
    removeAll: false,
  });

  return (
    <Accordion title='Quick Actions' defaultOpen data-accordion='true'>
      <div className='flex flex-col gap-3'>
        <Button
          size='lg'
          variant='default'
          className='bg-neutral-800 hover:bg-neutral-700 text-white font-medium cursor-pointer px-4 py-0 h-[48px] sm:h-[52px] text-sm sm:text-base sm:px-7 transition-all'
          disabled={loadingActions.addLogos}
          onClick={async () => {
            setLoadingActions((prev) => ({ ...prev, addLogos: true }));
            try {
              const pictures = await getPictureSuggestions();
              const logoImages = pictures.pictures.filter((p) =>
                p.startsWith('logo_'),
              );
              for (const fileName of logoImages) {
                try {
                  await addImageInput(roomId, fileName);
                } catch (e) {
                  console.warn(`Failed to add image ${fileName}:`, e);
                }
              }
              await refreshState();
            } catch (e) {
              console.error('Failed to add logos:', e);
            } finally {
              setLoadingActions((prev) => ({
                ...prev,
                addLogos: false,
              }));
            }
          }}>
          {loadingActions.addLogos ? (
            <span className='flex items-center gap-2'>
              <LoadingSpinner size='sm' variant='spinner' />
              Adding...
            </span>
          ) : (
            'Add Logos'
          )}
        </Button>
        <Button
          size='lg'
          variant='default'
          className='bg-neutral-800 hover:bg-neutral-700 text-white font-medium cursor-pointer px-4 py-0 h-[48px] sm:h-[52px] text-sm sm:text-base sm:px-7 transition-all'
          disabled={loadingActions.addTeam}
          onClick={async () => {
            setLoadingActions((prev) => ({ ...prev, addTeam: true }));
            try {
              const mp4s = await getMP4Suggestions();
              const teamMp4s = mp4s.mp4s.filter((m) =>
                m.startsWith('wrapped_'),
              );
              for (const fileName of teamMp4s) {
                try {
                  await addMP4Input(roomId, fileName);
                } catch (e) {
                  console.warn(`Failed to add mp4 ${fileName}:`, e);
                }
              }
              await refreshState();
            } catch (e) {
              console.error('Failed to add team:', e);
            } finally {
              setLoadingActions((prev) => ({
                ...prev,
                addTeam: false,
              }));
            }
          }}>
          {loadingActions.addTeam ? (
            <span className='flex items-center gap-2'>
              <LoadingSpinner size='sm' variant='spinner' />
              Adding...
            </span>
          ) : (
            'Add Team'
          )}
        </Button>
        <Button
          size='lg'
          variant='default'
          className='bg-neutral-800 hover:bg-neutral-700 text-white font-medium cursor-pointer px-4 py-0 h-[48px] sm:h-[52px] text-sm sm:text-base sm:px-7 transition-all'
          disabled={loadingActions.removeAll}
          onClick={async () => {
            setLoadingActions((prev) => ({ ...prev, removeAll: true }));
            try {
              const pictures = await getPictureSuggestions();
              const smelterLogo = pictures.pictures.find(
                (p) =>
                  p.toLowerCase().includes('smelter') &&
                  p.toLowerCase().includes('logo'),
              );
              if (smelterLogo) {
                try {
                  await addImageInput(roomId, smelterLogo);
                } catch (e) {
                  console.warn(`Failed to add smelter logo ${smelterLogo}:`, e);
                }
              }
              const currentInputs = [...inputs];
              for (const input of currentInputs) {
                try {
                  await removeInput(roomId, input.inputId);
                } catch (e) {
                  console.warn(`Failed to remove input ${input.inputId}:`, e);
                }
              }
              await refreshState();
            } catch (e) {
              console.error('Failed to remove all:', e);
            } finally {
              setLoadingActions((prev) => ({
                ...prev,
                removeAll: false,
              }));
            }
          }}>
          {loadingActions.removeAll ? (
            <span className='flex items-center gap-2'>
              <LoadingSpinner size='sm' variant='spinner' />
              Removing...
            </span>
          ) : (
            'Remove All'
          )}
        </Button>
      </div>
    </Accordion>
  );
}
