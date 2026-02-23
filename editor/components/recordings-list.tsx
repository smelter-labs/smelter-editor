'use client';

import { useEffect, useState } from 'react';
import {
  getRecordings,
  getRoomRecordings,
  type RecordingInfo,
} from '@/app/actions/actions';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import { Download, X } from 'lucide-react';
import { motion } from 'framer-motion';

interface RecordingsListProps {
  open: boolean;
  onClose: () => void;
  roomId?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export default function RecordingsList({
  open,
  onClose,
  roomId,
}: RecordingsListProps) {
  const [recordings, setRecordings] = useState<RecordingInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setLoading(true);
    setError(null);

    const fetchRecordings = roomId
      ? () => getRoomRecordings(roomId)
      : () => getRecordings();

    fetchRecordings()
      .then((data) => setRecordings(data))
      .catch(() => setError('Failed to fetch recordings'))
      .finally(() => setLoading(false));
  }, [open, roomId]);

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'
      onClick={onClose}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className='bg-[#141414] border border-[#2a2a2a] rounded-none p-6 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col'
        onClick={(e) => e.stopPropagation()}>
        <div className='flex items-center justify-between mb-4'>
          <h3 className='text-white text-lg font-medium'>Recordings</h3>
          <Button
            size='icon'
            variant='ghost'
            onClick={onClose}
            className='text-neutral-400 hover:text-white cursor-pointer'>
            <X className='w-5 h-5' />
          </Button>
        </div>

        <div className='overflow-y-auto flex-1'>
          {loading && (
            <div className='flex justify-center py-8'>
              <LoadingSpinner size='lg' />
            </div>
          )}

          {error && <p className='text-red-400 text-center py-8'>{error}</p>}

          {!loading && !error && recordings.length === 0 && (
            <p className='text-neutral-400 text-center py-8'>
              No recordings found
            </p>
          )}

          {!loading &&
            !error &&
            recordings.map((recording) => (
              <div
                key={recording.fileName}
                className='flex items-center justify-between gap-3 py-3 border-b border-[#2a2a2a] last:border-b-0'>
                <div className='min-w-0 flex-1'>
                  <p className='text-white text-sm truncate'>
                    {recording.fileName}
                  </p>
                  <p className='text-neutral-400 text-xs'>
                    {formatDate(recording.createdAt)} ·{' '}
                    {formatFileSize(recording.size)}
                  </p>
                </div>
                <a
                  href={`/api/recordings/${encodeURIComponent(recording.fileName)}`}
                  download>
                  <Button
                    size='icon'
                    variant='ghost'
                    className='text-neutral-400 hover:text-white cursor-pointer'>
                    <Download className='w-4 h-4' />
                  </Button>
                </a>
              </div>
            ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
