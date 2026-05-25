type DropIndicatorProps = {
  visible?: boolean;
  position?: 'top' | 'bottom';
};

export function DropIndicator({
  visible = false,
  position = 'top',
}: DropIndicatorProps) {
  if (!visible) return null;

  return (
    <div
      className={`pointer-events-none absolute left-0 right-0 z-20 h-0.5 bg-blue-500 ${
        position === 'top' ? 'top-0' : 'bottom-0'
      }`}
    />
  );
}
