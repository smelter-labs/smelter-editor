'use client';

import { useEffect, useRef } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useDriverTourControls } from '../tour/DriverTourContext';
import ArrowHint from './ArrowHint';

export default function TourLauncher() {
  const { start: startRoomTour, stop: stopRoomTour } =
    useDriverTourControls('room');
  const { start: startShadersTour, stop: stopShadersTour } =
    useDriverTourControls('shaders');
  const { start: startComposingTour, stop: stopComposingTour } =
    useDriverTourControls('composing');

  const roomTourBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      className='ml-auto flex items-center relative'
      data-tour='tour-launcher-container'
      style={{ minHeight: 52 }}>
      <span className='mr-2 text-white/70 text-sm font-bold'>Tours:</span>
      <div className='relative flex items-center flex-col'>
        <button
          ref={roomTourBtnRef}
          aria-label='Hello Smelter!'
          title='Hello Smelter!'
          onClick={() => {
            stopComposingTour?.();
            stopShadersTour?.();
            startRoomTour();
          }}
          className='disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center w-8 h-8 hover:bg-white/10 transition-colors cursor-pointer z-10'
          id='room-tour-launch-btn'
          style={{ position: 'relative', zIndex: 2 }}>
          <img
            src='/adding_streams_icon.svg'
            alt='Adding Streams'
            className='w-full h-full text-white/80 hover:text-white'
            style={{ display: 'block' }}
          />
        </button>
      </div>
      <ArrowHint targetRef={roomTourBtnRef} />
      <button
        aria-label='Composing Videos'
        title='Composing Videos'
        onClick={() => {
          stopRoomTour?.();
          stopShadersTour?.();
          startComposingTour();
        }}
        className='disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center w-8 h-8 hover:bg-white/10 transition-colors cursor-pointer'>
        <img
          src='/composing_videos_icon.svg'
          alt='Composing Videos'
          className='w-full h-full text-white/80 hover:text-white'
          style={{ display: 'block' }}
        />
      </button>
      <button
        aria-label='Using Shaders'
        title='Using Shaders'
        onClick={() => {
          stopRoomTour?.();
          stopComposingTour?.();
          startShadersTour();
        }}
        className='disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center w-8 h-8 hover:bg-white/10 transition-colors cursor-pointer'>
        <SlidersHorizontal className='w-5 h-5 text-white/80 hover:text-white' />
      </button>
    </div>
  );
}
