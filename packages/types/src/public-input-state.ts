import type { ActiveTransition } from './transition.js';
import type {
  InputType,
  InputStatus,
  InputSourceState,
  InputDisplayProperties,
  TextInputProperties,
  AbsolutePositionProperties,
  CropProperties,
  BorderProperties,
  SnakeGameDisplayProperties,
  MotionProperties,
  HandsProperties,
} from './input.js';

export type PublicInputState = {
  inputId: string;
  type: InputType;
  title: string;
  description: string;
  sourceState: InputSourceState;
  status: InputStatus;
  channelId?: string;
  url?: string;
  imageId?: string;
  mp4FileName?: string;
  audioFileName?: string;
  /** True when the server has no file on disk for this slot yet (import / missing asset). */
  mp4AssetMissing?: boolean;
  /** When mp4AssetMissing, whether to pick from audios/ instead of mp4s/. */
  missingAssetIsAudio?: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  attachedInputIds?: string[];
  hidden?: boolean;
  activeTransition?: ActiveTransition;
} & InputDisplayProperties &
  Partial<TextInputProperties> &
  Partial<AbsolutePositionProperties> &
  Partial<CropProperties> &
  Partial<BorderProperties> &
  Partial<SnakeGameDisplayProperties> &
  Partial<MotionProperties> &
  Partial<HandsProperties>;
