export function WarningBanner(props: any) {
  return (
    <div className='text-center py-4 lg:px-4'>
      <div
        className='p-2 bg-neutral-800 items-center text-white leading-none rounded-none flex lg:inline-flex'
        role='alert'>
        <span className='flex rounded-none bg-white text-black uppercase px-2 py-1 text-xs font-bold mr-3'>
          Warning
        </span>
        <span className='font-semibold mr-2 text-left flex-auto'>
          {props.children}
        </span>
      </div>
    </div>
  );
}
