import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { addKickInput, getKickSuggestions, Input } from '@/app/actions/actions';
import { GenericAddInputForm } from './generic-add-input-form';

type KickSuggestion = {
  streamId: string;
  displayName: string;
  title: string;
  category: string;
};

type KickAddInputFormProps = {
  inputs: Input[];
  roomId: string;
  refreshState: () => Promise<void>;
};

function extractKickChannelId(maybeUrl: string): string | undefined {
  try {
    const url = new URL(maybeUrl, 'https://dummy.base');
    if (['www.kick.com', 'kick.com'].includes(url.host)) {
      return url.pathname.replace(/^\/+|\/+$/g, '');
    }
  } catch {}
  return undefined;
}

export function KickAddInputForm({
  inputs,
  roomId,
  refreshState,
}: KickAddInputFormProps) {
  const [kickSuggestions, setKickSuggestions] = useState<KickSuggestion[]>([]);

  const refreshSuggestions = useCallback(async () => {
    const result = await getKickSuggestions();
    setKickSuggestions(
      (result.kick || []).map((stream) => ({
        streamId: stream.streamId,
        displayName: stream.displayName,
        title: stream.title,
        category: stream.category,
      })),
    );
  }, []);

  useEffect(() => {
    void refreshSuggestions();
    const interval = setInterval(refreshSuggestions, 30_000);
    return () => clearInterval(interval);
  }, [refreshSuggestions]);

  const usedKickChannelIds = new Set(
    inputs
      .filter((input) => input.channelId)
      .map((input) => input.channelId!.toLowerCase()),
  );

  const filterSuggestions = (
    suggestions: KickSuggestion[],
    currentSuggestion: string,
    _inputs: Input[],
  ) => {
    const search = currentSuggestion?.toLowerCase() ?? '';
    return suggestions
      .filter(
        (suggestion) =>
          !usedKickChannelIds.has(suggestion.streamId.toLowerCase()),
      )
      .filter((suggestion) => {
        if (!search) return true;
        return (
          suggestion.streamId.toLowerCase().includes(search) ||
          suggestion.title.toLowerCase().includes(search) ||
          suggestion.displayName.toLowerCase().includes(search) ||
          suggestion.category.toLowerCase().includes(search)
        );
      });
  };

  const handleSubmit = async (value: string) => {
    const channelId = extractKickChannelId(value) ?? value;
    try {
      await addKickInput(roomId, channelId);
    } catch (err) {
      toast.error(`Failed to add "${channelId}" Kick.com stream.`);
      throw err;
    }
  };

  const renderSuggestion = (
    suggestion: KickSuggestion,
    idx: number,
    highlighted: boolean,
  ) => (
    <>
      <span className='font-bold text-neutral-400 break-words'>
        {suggestion.title}
      </span>
      <span className='font-semibold break-all'>[{suggestion.streamId}]</span>
      <span className='ml-2 text-neutral-500 block'>
        [Kick.com] {suggestion.category}
      </span>
      <br />
    </>
  );

  return (
    <GenericAddInputForm
      submitOnItem={true}
      inputs={inputs}
      roomId={roomId}
      refreshState={refreshState}
      suggestions={kickSuggestions}
      filterSuggestions={filterSuggestions}
      placeholder='Select Channel'
      onSubmit={handleSubmit}
      renderSuggestion={renderSuggestion}
      getSuggestionValue={(suggestion) => suggestion.streamId}
      buttonText='Add input'
      loadingText='Add input'
      validateInput={undefined}
    />
  );
}
