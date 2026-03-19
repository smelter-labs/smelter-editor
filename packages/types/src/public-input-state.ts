import type { ActiveTransition } from './transition.js';
import type {
  InputType,
  InputStatus,
  InputSourceState,
  InputDisplayProperties,
  TextInputProperties,
  AbsolutePositionProperties,
  BorderProperties,
  SnakeGameDisplayProperties,
  MotionProperties,
} from './input.js';

export type PublicInputState = {
  inputId: string;
  type: InputType;
  title: string;
  description: string;
  sourceState: InputSourceState;
  status: InputStatus;
  channelId?: string;
  imageId?: string;
  attachedInputIds?: string[];
  hidden?: boolean;
  activeTransition?: ActiveTransition;
} & InputDisplayProperties &
  Partial<TextInputProperties> &
  Partial<AbsolutePositionProperties> &
  Partial<BorderProperties> &
  Partial<SnakeGameDisplayProperties> &
  Partial<MotionProperties>;
