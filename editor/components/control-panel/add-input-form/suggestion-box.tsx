import { useDriverTourControls } from '@/components/tour/DriverTourContext';
import { AnimatePresence, motion } from 'framer-motion';

export type SuggestionBoxProps<T> = {
  suggestions: T[];
  show: boolean;
  highlightedIndex: number;
  onSelect: (suggestion: T) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  suggestionBoxRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  suggestionBoxClass: string;
  renderSuggestion: (
    suggestion: T,
    idx: number,
    highlighted: boolean,
  ) => React.ReactNode;
  id?: string;
};

export function SuggestionBox<T>({
  suggestions,
  show,
  highlightedIndex,
  onSelect,
  onMouseDown,
  suggestionBoxRef,
  inputRef,
  suggestionBoxClass,
  renderSuggestion,
  id,
}: SuggestionBoxProps<T>) {
  const { next } = useDriverTourControls('room');
  return (
    <AnimatePresence>
      {show && suggestions.length > 0 && (
        <motion.div
          id={id}
          ref={suggestionBoxRef as React.RefObject<HTMLDivElement>}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15 }}
          className={suggestionBoxClass}
          style={{
            WebkitOverflowScrolling: 'touch',
            overflowX: 'hidden',
          }}>
          {suggestions.map((suggestion, idx) => (
            <button
              type='button'
              key={
                typeof suggestion === 'string'
                  ? suggestion
                  : ((suggestion as any).streamId ?? idx)
              }
              className={`w-full text-left px-3 py-2 hover:bg-neutral-800 hover:text-white focus:bg-neutral-700 focus:text-white transition-colors
                ${highlightedIndex === idx ? 'bg-neutral-800 text-white' : 'text-neutral-400'}
              `}
              onMouseDown={(e) => {
                e.preventDefault();
                onMouseDown?.(e);
              }}
              onClick={() => {
                onSelect(suggestion);
                inputRef.current?.focus();
              }}
              tabIndex={-1}
              style={{
                whiteSpace: 'normal',
                wordBreak: 'break-word',
              }}>
              {renderSuggestion(suggestion, idx, highlightedIndex === idx)}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
