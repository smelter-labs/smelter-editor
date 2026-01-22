export type AddInputResponse = {
  inputId: string;
  bearerToken: string;
  whipUrl: string;
};
export type InputWrapper = { id: number; inputId: string };

export type WhipSession = {
  roomId: string;
  inputId: string;
  bearerToken: string;
  location: string | null;
  ts: number;
};
