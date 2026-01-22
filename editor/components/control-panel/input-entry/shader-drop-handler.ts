import { AvailableShader, Input } from '@/app/actions/actions';

interface HandleShaderDropParams {
  e: React.DragEvent<HTMLDivElement>;
  input: Input;
  availableShaders: AvailableShader[];
  onShaderToggle: (shaderId: string) => void;
  onAddShader: (shaderId: string) => Promise<void>;
}

export function handleShaderDrop({
  e,
  input,
  availableShaders,
  onShaderToggle,
  onAddShader,
}: HandleShaderDropParams): void {
  try {
    e.preventDefault();
    const shaderId = e.dataTransfer.getData('application/x-smelter-shader');
    if (!shaderId) return;

    const existing = input.shaders?.find((s) => s.shaderId === shaderId);
    if (!existing) {
      void onAddShader(shaderId);
      return;
    }
    if (!existing.enabled) {
      onShaderToggle(shaderId);
    }
  } catch {
    // Ignore errors
  }
}

export function handleShaderDragOver(e: React.DragEvent<HTMLDivElement>): void {
  if (e.dataTransfer.types?.includes('application/x-smelter-shader')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}
