import type { SnakeEventType } from '@/lib/game-types';

export const SNAKE_EVENT_TYPES: {
  type: SnakeEventType;
  label: string;
  description: string;
}[] = [
  { type: 'speed_up', label: 'Speed Up', description: 'Snake accelerates' },
  {
    type: 'cut_opponent',
    label: 'Cut Opponent',
    description: 'Cut through an opponent snake',
  },
  {
    type: 'got_cut',
    label: 'Got Cut',
    description: 'Got cut by another snake',
  },
  { type: 'cut_self', label: 'Cut Self', description: 'Cut through own body' },
  { type: 'eat_block', label: 'Eat Block', description: 'Ate a food block' },
  {
    type: 'bounce_block',
    label: 'Bounce Block',
    description: 'Bounced off a block',
  },
  {
    type: 'no_moves',
    label: 'No Moves',
    description: 'No possible moves left',
  },
  { type: 'game_over', label: 'Game Over', description: 'Game ended' },
];
