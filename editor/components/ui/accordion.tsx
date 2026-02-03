// Animated Accordion implementation with toggleAccordionBySelector/open/close methods
import { motion, AnimatePresence } from 'framer-motion';
import React, {
  useState,
  useRef,
  useImperativeHandle,
  forwardRef,
  HTMLAttributes,
} from 'react';

type AccordionProps = {
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  id?: string;
  /**
   * Optional custom icon to show on the header instead of the default chevron.
   */
  headerIcon?: React.ReactNode;
  /**
   * If provided, clicking the header will call this instead of toggling.
   */
  onHeaderClick?: () => void;
} & React.HTMLAttributes<HTMLDivElement>;

export type AccordionHandle = {
  /**
   * Toggle the accordion open if the given selector matches any child element.
   */
  toggleAccordionBySelector: (selector: string) => void;
  /**
   * Open the accordion if the given selector matches any child element.
   */
  openAccordionBySelector: (selector: string) => void;
  /**
   * Close the accordion if the given selector matches any child element.
   */
  closeAccordionBySelector: (selector: string) => void;
  /**
   * Imperatively open the accordion, regardless of content/selector.
   */
  open: () => void;
  /**
   * Imperatively close the accordion, regardless of content/selector.
   */
  close: () => void;
};

const Accordion = forwardRef<AccordionHandle, AccordionProps>(
  function Accordion(
    {
      title,
      children,
      defaultOpen = false,
      id = '',
      headerIcon,
      onHeaderClick,
      ...rest
    },
    ref,
  ) {
    const [open, setOpen] = useState(defaultOpen);

    const accordionContentRef = useRef<HTMLDivElement>(null);

    // Toggle the accordion if a child matching the selector is found
    const toggleAccordionBySelector = (selector: string) => {
      if (!accordionContentRef.current) return;
      if (accordionContentRef.current.querySelector(selector)) {
        setOpen((prev) => !prev);
      }
    };

    // Open the accordion if a child matching the selector is found
    const openAccordionBySelector = (selector: string) => {
      if (!accordionContentRef.current) return;
      if (accordionContentRef.current.querySelector(selector)) {
        setOpen(true);
      }
    };

    // Close the accordion if a child matching the selector is found
    const closeAccordionBySelector = (selector: string) => {
      if (!accordionContentRef.current) return;
      if (accordionContentRef.current.querySelector(selector)) {
        setOpen(false);
      }
    };

    useImperativeHandle(
      ref,
      () => ({
        toggleAccordionBySelector,
        openAccordionBySelector,
        closeAccordionBySelector,
        open: () => setOpen(true),
        close: () => setOpen(false),
      }),
      [],
    );

    return (
      <div
        className='border border-neutral-800 rounded-md'
        data-open={open}
        data-accordion='true'
        id={id}
        {...rest}>
        <button
          type='button'
          className='flex items-center w-full px-2 py-1.5 focus:outline-none select-none bg-neutral-900 rounded-none border-neutral-800 border-b cursor-pointer'
          onClick={() => {
            if (onHeaderClick) {
              onHeaderClick();
              return;
            }
            setOpen((o) => !o);
          }}
          aria-expanded={open}>
          {headerIcon ? (
            <span
              className='mr-2 flex items-center justify-center'
              style={{ color: '#fff' }}>
              {headerIcon}
            </span>
          ) : (
            <span
              className='transition-transform duration-300 mr-2 flex items-center justify-center'
              style={{
                transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                color: '#fff',
              }}>
              <svg width='18' height='18' viewBox='0 0 20 20' fill='none'>
                <path
                  d='M7 5L13 10L7 15'
                  stroke='currentColor'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </svg>
            </span>
          )}
          <h3 className='text-white text-sm font-medium'>{title}</h3>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key='content'
              className='px-2 pb-2 pt-2'
              initial='collapsed'
              animate='open'
              exit='collapsed'
              variants={{
                open: { height: 'auto', opacity: 1, marginTop: 0 },
                collapsed: { height: 0, opacity: 0, marginTop: 0 },
              }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              style={{ overflow: 'visible' }}>
              <div className='p-2' ref={accordionContentRef}>
                {children}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  },
);

export default Accordion;
