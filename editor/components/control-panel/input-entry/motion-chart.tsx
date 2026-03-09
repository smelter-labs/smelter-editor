'use client';

interface MotionChartProps {
  history: number[];
  peak: number;
  current: number;
  width?: number;
  height?: number;
}

export function MotionChart({
  history,
  peak,
  current,
  width = 200,
  height = 32,
}: MotionChartProps) {
  if (history.length < 2) return null;

  const maxVal = Math.max(peak, 0.05);
  const points = history.map((val, i) => {
    const x = (i / (history.length - 1)) * width;
    const y = height - (val / maxVal) * height;
    return `${x},${y}`;
  });

  const areaPoints = [`0,${height}`, ...points, `${width},${height}`].join(' ');
  const linePoints = points.join(' ');

  return (
    <div className='px-2 pb-1'>
      <svg
        width={width}
        height={height}
        className='w-full'
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio='none'>
        <polygon points={areaPoints} fill='rgba(34, 197, 94, 0.15)' />
        <polyline
          points={linePoints}
          fill='none'
          stroke='rgba(34, 197, 94, 0.6)'
          strokeWidth='1.5'
        />
      </svg>
      <div className='flex justify-between text-[10px] text-neutral-500 mt-0.5'>
        <span>peak: {(peak * 100).toFixed(0)}%</span>
        <span>now: {(current * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}
