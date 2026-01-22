import { motion } from 'framer-motion';
import { Button } from './button';

interface AutoplayModalProps {
  onAllow: () => void;
  onDeny: () => void;
}

export default function AutoplayModal({ onAllow, onDeny }: AutoplayModalProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 '>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className='bg-[#141414] border border-[#2a2a2a] rounded-none p-6 max-w-md mx-4 '>
        <h3 className='text-white text-lg font-medium mb-4'>Play Video?</h3>
        <p className='text-neutral-400 mb-6'>
          Browsers don&apos;t allow videos to play automatically. If you want to
          start the video now, please confirm.
        </p>
        <div className='flex gap-3 justify-end'>
          <Button
            size='lg'
            variant='default'
            onClick={onDeny}
            className='bg-neutral-700 hover:bg-neutral-600 text-white font-medium cursor-pointer'>
            Not Now
          </Button>
          <Button
            size='lg'
            variant='default'
            onClick={onAllow}
            className='bg-white hover:bg-neutral-200 text-black font-medium border-0 cursor-pointer'>
            Play Video
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
