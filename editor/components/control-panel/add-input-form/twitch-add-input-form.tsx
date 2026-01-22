import {
  addTwitchInput,
  connectInput,
  getTwitchSuggestions,
  Input,
  InputSuggestions,
} from '@/app/actions/actions';
import { useCallback, useEffect, useState } from 'react';
import { GenericAddInputForm } from './generic-add-input-form';
import { toast } from 'react-toastify';

// --- AddInputForm for Twitch ---
export default function TwitchAddInputForm({
  inputs,
  roomId,
  refreshState,
}: {
  inputs: Input[];
  roomId: string;
  refreshState: () => Promise<void>;
}) {
  // Move suggestions logic here
  const [suggestions, setSuggestions] = useState<InputSuggestions>({
    twitch: [],
  });

  // UseCallback to avoid unnecessary effect reruns
  const refreshSuggestions = useCallback(async () => {
    const state = await getTwitchSuggestions();
    setSuggestions(state);
  }, []);

  useEffect(() => {
    void refreshSuggestions();
    const interval = setInterval(refreshSuggestions, 30_000);
    return () => clearInterval(interval);
  }, [refreshSuggestions]);

  function tryTwitchIdFromUrl(maybeUrl: string): string | undefined {
    try {
      // Use WHATWG URL for browser compatibility
      const url = new URL(maybeUrl, 'https://dummy.base'); // fallback for relative
      if (['www.twitch.tv', 'twitch.tv'].includes(url.host)) {
        // Remove leading/trailing slashes
        return url.pathname.replace(/^\/+|\/+$/g, '');
      }
    } catch {
      return;
    }
  }

  return (
    <GenericAddInputForm
      id='twitch-suggestion-container'
      inputs={inputs}
      roomId={roomId}
      refreshState={refreshState}
      suggestions={suggestions.twitch}
      submitOnItem={true}
      showButton={true}
      filterSuggestions={(twitchSuggestions, currentSuggestion, inputs) =>
        twitchSuggestions
          .filter((suggestion) => {
            for (const input of inputs) {
              if (input.channelId === suggestion.streamId) {
                return false;
              }
            }
            return true;
          })
          .filter((suggestion) => {
            if (!currentSuggestion) return true;
            return (
              suggestion.streamId
                .toLowerCase()
                .includes(currentSuggestion.toLowerCase()) ||
              suggestion.title
                .toLowerCase()
                .includes(currentSuggestion.toLowerCase())
            );
          })
      }
      placeholder='Select Channel'
      onSubmit={async (value: string) => {
        const channelId = tryTwitchIdFromUrl(value) ?? value;
        try {
          const newInput = await addTwitchInput(roomId, channelId);
        } catch (err) {
          toast.error(`Failed to add "${channelId}" Twitch.tv stream.`);
          throw err;
        }
      }}
      renderSuggestion={(suggestion, idx, highlighted) => (
        <div data-tour='twitch-suggestion-item-container'>
          <span className='font-semibold break-all'>{suggestion.streamId}</span>
          <br />
          <span className='font-bold text-neutral-400 break-words'>
            {suggestion.title}
          </span>
          <span className='ml-2 text-neutral-500 block'>[Twitch.tv]</span>
        </div>
      )}
      getSuggestionValue={(suggestion) => suggestion.streamId}
      buttonText='Add input'
      loadingText='Add input'
      validateInput={undefined}
    />
  );
}
