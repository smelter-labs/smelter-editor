'use client';

interface MotionChartProps {
  history: number[];
  peak: number;
  current: number;
  width?: number;
  height?: number;
}

function getMotionColor(value: number): {
  fill: string;
  stroke: string;
} {
  if (value >= 0.6)
    return { fill: 'rgba(239, 68, 68, 0.2)', stroke: 'rgba(239, 68, 68, 0.7)' };
  if (value >= 0.3)
    return { fill: 'rgba(234, 179, 8, 0.2)', stroke: 'rgba(234, 179, 8, 0.7)' };
  return { fill: 'rgba(34, 197, 94, 0.15)', stroke: 'rgba(34, 197, 94, 0.6)' };
}

export function MotionChart({
  history,
  peak,
  current,
  width = 200,
  height = 80,
}: MotionChartProps) {
  if (history.length < 2) return null;

  const points = history.map((val, i) => {
    const x = (i / (history.length - 1)) * width;
    const y = height - Math.min(val, 1) * height;
    return `${x},${y}`;
  });

  const areaPoints = [`0,${height}`, ...points, `${width},${height}`].join(' ');
  const linePoints = points.join(' ');
  const color = getMotionColor(current);

  return (
    <div className='h-full flex flex-col'>
      <svg
        className='w-full flex-1'
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio='none'>
        <polygon points={areaPoints} fill={color.fill} />
        <polyline
          points={linePoints}
          fill='none'
          stroke={color.stroke}
          strokeWidth='1.5'
        />
      </svg>
      <div className='flex justify-between text-[10px] text-neutral-500 mt-1 px-0.5 shrink-0'>
        <span>peak: {(peak * 100).toFixed(0)}%</span>
        <span>now: {(current * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}
