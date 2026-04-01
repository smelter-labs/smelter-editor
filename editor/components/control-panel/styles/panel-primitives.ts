import { cva } from 'class-variance-authority';

/**
 * Shared class patterns for control-panel UI elements.
 * Uses semantic tokens from globals.css so the cyberpunk redesign
 * only needs to change the token values.
 */

/** Label text — used before form fields and sections */
export const labelStyles = cva('text-xs text-muted-foreground', {
  variants: {
    size: {
      sm: 'text-[10px]',
      md: 'text-xs',
      lg: 'text-sm',
    },
    block: {
      true: 'block mb-1',
      false: '',
    },
  },
  defaultVariants: { size: 'md', block: false },
});

/** Dark input / select-trigger wrapper */
export const panelInputStyles = cva(
  'bg-card border border-border text-foreground text-xs px-2 py-1',
  {
    variants: {
      fullWidth: {
        true: 'w-full',
        false: '',
      },
      compact: {
        true: 'h-auto',
        false: '',
      },
    },
    defaultVariants: { fullWidth: false, compact: false },
  },
);

/** Card-like section within a panel (borders, padding, spacing) */
export const panelSectionStyles = cva(
  'border border-border rounded p-2 mb-3 mt-1',
);

/** Ghost action button in panels */
const panelActionBtnStyles = cva(
  'bg-card border-border hover:bg-accent cursor-pointer',
  {
    variants: {
      size: {
        sm: 'px-2 py-1 text-xs',
        md: 'px-3 py-1.5 text-sm',
      },
    },
    defaultVariants: { size: 'sm' },
  },
);
