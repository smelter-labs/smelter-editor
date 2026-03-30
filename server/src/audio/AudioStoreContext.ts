import { createContext } from 'react';
import type { StoreApi } from 'zustand';
import type { AudioStoreState } from './audioStore';

export const AudioStoreContext =
  createContext<StoreApi<AudioStoreState> | null>(null);
