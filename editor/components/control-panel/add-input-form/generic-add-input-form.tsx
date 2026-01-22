import { useState, useRef, useEffect } from 'react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import { SuggestionBox } from './suggestion-box';
import type { Input } from '@/app/actions/actions';
import { useDriverTourControls } from '@/components/tour/DriverTourContext';

export type GenericAddInputFormProps<T> = {
  inputs: Input[];
  roomId?: string;
  refreshState: () => Promise<void>;
  suggestions: T[];
  filterSuggestions?: (
    suggestions: T[],
    currentSuggestion: string,
    inputs: Input[],
  ) => T[];
  placeholder: string;
  onSubmit: (value: string) => Promise<void>;
  renderSuggestion: (
    suggestion: T,
    idx: number,
    highlighted: boolean,
  ) => React.ReactNode;
  getSuggestionValue: (suggestion: T) => string;
  buttonText: string;
  loadingText?: string;
  validateInput?: (value: string) => string | undefined;
  initialValue?: string;
  showArrow?: boolean;
  inputDisabled?: boolean;
  id?: string;
  submitOnItem?: boolean;
  showButton?: boolean;
  forceShowButton?: boolean;
};

export function GenericAddInputForm<T>({
  inputs,
  roomId,
  refreshState,
  suggestions,
  filterSuggestions,
  placeholder,
  onSubmit,
  renderSuggestion,
  getSuggestionValue,
  buttonText,
  loadingText,
  validateInput,
  initialValue = '',
  showArrow = true,
  inputDisabled = false,
  id = '',
  submitOnItem = false,
  showButton = true,
  forceShowButton = false,
}: GenericAddInputFormProps<T>) {
  const [currentSuggestion, setCurrentSuggestion] = useState(initialValue);
  const [userTyped, setUserTyped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [windowWidth, setWindowWidth] = useState<number | undefined>(undefined);
  const { nextIf, next, reset } = useDriverTourControls('room');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestionBoxRef = useRef<HTMLDivElement | null>(null);
  const [isRoomTourActive, setIsRoomTourActive] = useState(false);
  const [hasSelectedDuringTour, setHasSelectedDuringTour] = useState(false);

  useEffect(() => {
    setCurrentSuggestion(initialValue);
    setUserTyped(false);
  }, [initialValue]);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const filteredSuggestions = filterSuggestions
    ? filterSuggestions(suggestions, currentSuggestion, inputs)
    : suggestions;

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [filteredSuggestions.length, showSuggestions, currentSuggestion]);

  useEffect(() => {
    if (!showSuggestions) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        suggestionBoxRef.current &&
        !suggestionBoxRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSuggestions]);

  useEffect(() => {
    const onStart = (e: any) => {
      try {
        if (e?.detail?.id === 'room') {
          setIsRoomTourActive(true);
          setHasSelectedDuringTour(false);
        }
      } catch {}
    };
    const onStop = (e: any) => {
      try {
        if (e?.detail?.id === 'room') {
          setIsRoomTourActive(false);
          setHasSelectedDuringTour(false);
        }
      } catch {}
    };
    window.addEventListener('smelter:tour:start', onStart);
    window.addEventListener('smelter:tour:stop', onStop);
    return () => {
      window.removeEventListener('smelter:tour:start', onStart);
      window.removeEventListener('smelter:tour:stop', onStop);
    };
  }, []);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (inputDisabled) {
      if (
        e.key !== 'ArrowDown' &&
        e.key !== 'ArrowUp' &&
        e.key !== 'Enter' &&
        e.key !== 'Escape'
      ) {
        e.preventDefault();
        return;
      }
    }
    if (!showSuggestions || filteredSuggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < filteredSuggestions.length - 1 ? prev + 1 : 0,
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredSuggestions.length - 1,
      );
    } else if (e.key === 'Enter') {
      if (
        highlightedIndex >= 0 &&
        highlightedIndex < filteredSuggestions.length
      ) {
        e.preventDefault();
        const shouldLock =
          isRoomTourActive &&
          !hasSelectedDuringTour &&
          !!suggestionBoxRef.current?.querySelector(
            '[data-tour="twitch-suggestion-item-container"]',
          );
        if (shouldLock && submitOnItem) {
          void handleSuggestionSelect(filteredSuggestions[highlightedIndex]);
          return;
        }
        setCurrentSuggestion(
          getSuggestionValue(filteredSuggestions[highlightedIndex]),
        );
        setShowSuggestions(false);
        setHighlightedIndex(-1);
      }
    }
  };

  const suggestionBoxClass =
    'absolute z-30 left-0 right-0 mt-1 bg-[#141414] border border-neutral-700 max-h-56 min-w-0 w-full overflow-y-auto text-sm sm:text-base';

  const handleSubmit = async (e?: React.FormEvent | Event) => {
    if (e) e.preventDefault();
    const value = currentSuggestion.trim();
    if (validateInput) {
      const error = validateInput(value);
      if (error) {
        toast.error(error);
        return;
      }
    }
    setLoading(true);
    try {
      await onSubmit(value);
      await refreshState();
      setCurrentSuggestion('');
      setUserTyped(false);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitOnItem = async (value: string) => {
    setLoading(true);
    try {
      await onSubmit(value);
      await refreshState();
      setCurrentSuggestion('');
      setUserTyped(false);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!inputDisabled) {
      setCurrentSuggestion(e.target.value);
      setShowSuggestions(true);
      setUserTyped(true);
    }
  };

  const handleSuggestionSelect = async (suggestion: T) => {
    const value = getSuggestionValue(suggestion);
    setCurrentSuggestion(value);
    setUserTyped(false);
    setShowSuggestions(false);
    if (isRoomTourActive) {
      setHasSelectedDuringTour(true);
    }

    if (submitOnItem) {
      next();
      await handleSubmitOnItem(value);

      await new Promise((resolve) => setTimeout(resolve, 200));
      setShowSuggestions(false);
      next();
      inputRef.current?.blur();
    }
  };

  return (
    <form
      className='flex flex-row w-full gap-2 sm:gap-3 items-center relative'
      autoComplete='off'
      onSubmit={handleSubmit}>
      <div className='relative flex-1 min-w-0 my-2 sm:my-2'>
        <input
          ref={inputRef}
          className={
            'py-3 pl-3 pr-8 sm:py-3 sm:pl-3 sm:pr-10 border-neutral-700 border text-neutral-300 rounded-none w-full min-w-0 text-sm sm:text-base outline-none focus:ring-2 focus:ring-neutral-600 transition-all ' +
            (loading ? 'bg-white/10 ' : 'bg-transparent ') +
            (inputDisabled ? ' select-none bg-[#141414] cursor-pointer' : '')
          }
          value={currentSuggestion}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          autoComplete='off'
          spellCheck={false}
          readOnly={inputDisabled}
          onClick={() => {
            setShowSuggestions(true);
            setTimeout(() => next(), 200);
          }}
        />
        {showArrow && !loading && (
          <span
            className='pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-white opacity-100'
            aria-hidden='true'>
            <svg width='24' height='24' viewBox='0 0 24 24' fill='white'>
              <polygon points='7,9 12,16 17,9' />
            </svg>
          </span>
        )}
        {loading && (
          <div className='absolute inset-0 rounded-none bg-black/40 flex items-center justify-center z-10'>
            <LoadingSpinner size='lg' variant='spinner' />
          </div>
        )}
        <SuggestionBox<T>
          id={id}
          suggestions={filteredSuggestions}
          show={showSuggestions}
          highlightedIndex={highlightedIndex}
          onSelect={handleSuggestionSelect}
          suggestionBoxRef={suggestionBoxRef}
          inputRef={inputRef}
          suggestionBoxClass={suggestionBoxClass}
          renderSuggestion={renderSuggestion}
        />
      </div>
      {showButton &&
        (forceShowButton ||
          (userTyped && currentSuggestion.trim().length > 0)) && (
          <Button
            size='lg'
            variant='default'
            className='bg-neutral-800 hover:bg-neutral-700 text-white font-medium cursor-pointer px-4 py-0 h-[48px] sm:h-[52px] text-sm sm:text-base sm:px-7 transition-all rounded-none'
            type='submit'
            disabled={loading}>
            {loading ? (
              <>
                <LoadingSpinner size='sm' variant='spinner' /> {loadingText}
              </>
            ) : (
              <>{buttonText}</>
            )}
          </Button>
        )}
    </form>
  );
}
