'use client';

export function CaptionsCheckbox({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <button
      type='button'
      onClick={() => onChange(!enabled)}
      className='flex items-center gap-2 w-full text-left'>
      <span
        className={`w-3.5 h-3.5 border flex items-center justify-center text-[9px] font-bold ${
          enabled
            ? 'bg-[#00f3ff] border-[#00f3ff] text-black'
            : 'bg-[#1c1b1b] border-[#3a494b]/40 text-transparent'
        }`}>
        ✓
      </span>
      <span className='text-[10px] font-mono uppercase text-[#849495]'>
        Captions (speech-to-text)
      </span>
    </button>
  );
}
