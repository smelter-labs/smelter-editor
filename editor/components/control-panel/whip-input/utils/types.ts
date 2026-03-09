export type { AddInputResponse } from '@/lib/types';
export type InputWrapper = { id: number; inputId: string };

export type WhipSession = {
  roomId: string;
  inputId: string;
  bearerToken: string;
  location: string | null;
  ts: number;
};
