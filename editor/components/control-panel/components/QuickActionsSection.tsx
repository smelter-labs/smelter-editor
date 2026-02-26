import { useState } from 'react';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import {
  getPictureSuggestions,
  getMP4Suggestions,
  addImageInput,
  addMP4Input,
  removeInput,
  hideInput,
} from '@/app/actions/actions';
import { useControlPanelContext } from '../contexts/control-panel-context';

export function QuickActionsSection() {
  const { inputs, roomId, refreshState } = useControlPanelContext();
  const [loadingActions, setLoadingActions] = useState<{
    addLogos: boolean;
    addTeam: boolean;
    removeAll: boolean;
    deleteAll: boolean;
  }>({
    addLogos: false,
    addTeam: false,
    removeAll: false,
    deleteAll: false,
  });

  return (
    <div className='flex flex-col gap-3'>
      {/* Add logos */}
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
      {/* Add wrapped team MP4s */}
      <Button
        size='lg'
        variant='default'
        className='bg-neutral-800 hover:bg-neutral-700 text-white font-medium cursor-pointer px-4 py-0 h-[48px] sm:h-[52px] text-sm sm:text-base sm:px-7 transition-all'
        disabled={loadingActions.addTeam}
        onClick={async () => {
          setLoadingActions((prev) => ({ ...prev, addTeam: true }));
          try {
            const mp4s = await getMP4Suggestions();
            const teamMp4s = mp4s.mp4s.filter((m) => m.startsWith('wrapped_'));
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
      {/* Soft clear: hide all inputs and show Smelter logo */}
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
                await hideInput(roomId, input.inputId);
              } catch (e) {
                console.warn(`Failed to hide input ${input.inputId}:`, e);
              }
            }
            await refreshState();
          } catch (e) {
            console.error('Failed to hide all inputs:', e);
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
            Hiding...
          </span>
        ) : (
          'Hide All'
        )}
      </Button>
      {/* Hard delete: remove all inputs with confirmation */}
      <Button
        size='lg'
        variant='destructive'
        className='font-medium cursor-pointer px-4 py-0 h-[48px] sm:h-[52px] text-sm sm:text-base sm:px-7 transition-all'
        disabled={loadingActions.deleteAll}
        onClick={async () => {
          const confirmed = window.confirm(
            'Delete ALL inputs permanently? This will also remove their timeline segments.',
          );
          if (!confirmed) return;
          setLoadingActions((prev) => ({ ...prev, deleteAll: true }));
          try {
            const currentInputs = [...inputs];
            for (const input of currentInputs) {
              try {
                try {
                  await hideInput(roomId, input.inputId);
                } catch {}
                await removeInput(roomId, input.inputId);
              } catch (e) {
                console.warn(`Failed to delete input ${input.inputId}:`, e);
              }
            }
            await refreshState();
          } catch (e) {
            console.error('Failed to delete all inputs:', e);
          } finally {
            setLoadingActions((prev) => ({
              ...prev,
              deleteAll: false,
            }));
          }
        }}>
        {loadingActions.deleteAll ? (
          <span className='flex items-center gap-2'>
            <LoadingSpinner size='sm' variant='spinner' />
            Deleting...
          </span>
        ) : (
          'Delete All Inputs'
        )}
      </Button>
    </div>
  );
}
