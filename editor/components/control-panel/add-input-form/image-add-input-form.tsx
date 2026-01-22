import {
  addImageInput,
  getPictureSuggestions,
  Input,
  PictureSuggestions,
} from '@/app/actions/actions';
import { useEffect, useState } from 'react';
import { GenericAddInputForm } from './generic-add-input-form';
import { toast } from 'react-toastify';

export function ImageAddInputForm({
  inputs,
  roomId,
  refreshState,
}: {
  inputs: Input[];
  roomId: string;
  refreshState: () => Promise<void>;
}) {
  const [pictureSuggestions, setPictureSuggestions] =
    useState<PictureSuggestions>({
      pictures: [],
    });

  useEffect(() => {
    getPictureSuggestions().then(setPictureSuggestions);
  }, []);

  return (
    <GenericAddInputForm<string>
      id='image-suggestion-container'
      inputs={inputs}
      showButton={false}
      roomId={roomId}
      inputDisabled={true}
      refreshState={refreshState}
      suggestions={pictureSuggestions.pictures}
      placeholder='Select image from list'
      onSubmit={async (imageFileName: string) => {
        if (!imageFileName) {
          toast.error('Please select an image.');
          throw new Error('No Image File');
        }
        try {
          await addImageInput(roomId, imageFileName);
        } catch (err) {
          toast.error(`Failed to add "${imageFileName}" image input.`);
          throw err;
        }
      }}
      renderSuggestion={(imageUrl, idx, highlighted) => (
        <>
          <span className='font-semibold break-all'>{imageUrl}</span>
          <span className='ml-2 text-neutral-500 block'>[Image]</span>
        </>
      )}
      getSuggestionValue={(imageUrl) => imageUrl}
      buttonText='Add Image'
      loadingText='Add Image'
      validateInput={(value) =>
        !value ? 'Please select image file.' : undefined
      }
      submitOnItem={true}
    />
  );
}
