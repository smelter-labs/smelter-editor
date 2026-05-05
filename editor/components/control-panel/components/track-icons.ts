import {
  Mic,
  Video,
  Music,
  Camera,
  Headphones,
  Image as ImageIcon,
  Film,
  Clapperboard,
  Monitor,
  Tv,
  Radio,
  Megaphone,
  Volume2,
  Star,
  Heart,
  Bookmark,
  Tag,
  Flag,
  Folder,
  FolderOpen,
  Box,
  Layers,
  User,
  Users,
  Sparkles,
  Wand2,
  Zap,
  Palette,
  Eye,
  EyeOff,
  type LucideIcon,
} from 'lucide-react';

export const TRACK_ICON_REGISTRY = {
  layers: Layers,
  mic: Mic,
  video: Video,
  music: Music,
  camera: Camera,
  headphones: Headphones,
  image: ImageIcon,
  film: Film,
  clapperboard: Clapperboard,
  monitor: Monitor,
  tv: Tv,
  radio: Radio,
  megaphone: Megaphone,
  volume: Volume2,
  star: Star,
  heart: Heart,
  bookmark: Bookmark,
  tag: Tag,
  flag: Flag,
  folder: Folder,
  'folder-open': FolderOpen,
  box: Box,
  user: User,
  users: Users,
  sparkles: Sparkles,
  wand: Wand2,
  zap: Zap,
  palette: Palette,
  eye: Eye,
  'eye-off': EyeOff,
} as const satisfies Record<string, LucideIcon>;

export type TrackIconKey = keyof typeof TRACK_ICON_REGISTRY;

export const TRACK_ICON_KEYS = Object.keys(
  TRACK_ICON_REGISTRY,
) as TrackIconKey[];

export const DEFAULT_TRACK_ICON: TrackIconKey = 'layers';
export const DEFAULT_GROUP_ICON: TrackIconKey = 'folder';

export function isTrackIconKey(value: unknown): value is TrackIconKey {
  return typeof value === 'string' && value in TRACK_ICON_REGISTRY;
}

export function getTrackIcon(key: string | undefined): LucideIcon {
  if (key && isTrackIconKey(key)) return TRACK_ICON_REGISTRY[key];
  return TRACK_ICON_REGISTRY[DEFAULT_TRACK_ICON];
}

export function getGroupIcon(
  key: string | undefined,
  collapsed: boolean,
): LucideIcon {
  if (key && isTrackIconKey(key)) return TRACK_ICON_REGISTRY[key];
  return collapsed
    ? TRACK_ICON_REGISTRY['folder']
    : TRACK_ICON_REGISTRY['folder-open'];
}
