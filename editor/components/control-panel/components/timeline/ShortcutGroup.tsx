export function ShortcutGroup({
  title,
  items,
}: {
  title: string;
  items: [string, string][];
}) {
  return (
    <div>
      <h3 className='text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2'>
        {title}
      </h3>
      <div className='space-y-1'>
        {items.map(([key, desc]) => (
          <div key={key} className='flex items-center justify-between'>
            <span className='text-muted-foreground'>{desc}</span>
            <kbd className='text-[11px] text-card-foreground bg-card border border-border rounded px-1.5 py-0.5 font-mono min-w-[24px] text-center'>
              {key}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
}
