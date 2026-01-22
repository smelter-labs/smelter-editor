import {
  addMP4Input,
  getMP4Suggestions,
  Input,
  MP4Suggestions,
} from '@/app/actions/actions';
import { useEffect, useState } from 'react';
import { GenericAddInputForm } from './generic-add-input-form';
import { toast } from 'react-toastify';

export function Mp4AddInputForm({
  inputs,
  roomId,
  refreshState,
}: {
  inputs: Input[];
  roomId: string;
  refreshState: () => Promise<void>;
}) {
  const [mp4Suggestions, setMp4Suggestions] = useState<MP4Suggestions>({
    mp4s: [],
  });

  useEffect(() => {
    getMP4Suggestions().then(setMp4Suggestions);
  }, []);

  return (
    <GenericAddInputForm<string>
      id='mp4-suggestion-container'
      inputs={inputs}
      showButton={false}
      roomId={roomId}
      inputDisabled={true}
      refreshState={refreshState}
      suggestions={mp4Suggestions.mp4s}
      placeholder='Select MP4 from list'
      onSubmit={async (mp4FileName: string) => {
        if (!mp4FileName) {
          toast.error('Please select an MP4.');
          throw new Error('No MP4 File');
        }
        try {
          await addMP4Input(roomId, mp4FileName);
        } catch (err) {
          toast.error(`Failed to add "${mp4FileName}" MP4 input.`);
          throw err;
        }
      }}
      renderSuggestion={(mp4Url, idx, highlighted) => (
        <>
          <span className='font-semibold break-all'>{mp4Url}</span>
          <span className='ml-2 text-neutral-500 block'>[MP4]</span>
        </>
      )}
      getSuggestionValue={(mp4Url) => mp4Url}
      buttonText='Add MP4'
      loadingText='Add MP4'
      validateInput={(value) => (!value ? 'Please select MP4 URL.' : undefined)}
      submitOnItem={true}
    />
  );
}
