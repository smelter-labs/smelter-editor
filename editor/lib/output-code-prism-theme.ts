import type { CSSProperties } from 'react';

/** Matches System_Log_Feed.lnk terminal palette */
const TEXT = '#b9cacb';
const MUTED = '#849495';
const LIME = '#bded00';
const CYAN = '#00f3ff';
const MAGENTA = '#fe00fe';

const baseCodeStyle: CSSProperties = {
  color: TEXT,
  background: 'transparent',
  fontFamily: 'ui-monospace, monospace',
  direction: 'ltr',
  textAlign: 'left',
  whiteSpace: 'pre',
  wordSpacing: 'normal',
  wordBreak: 'normal',
  lineHeight: 1.5,
  tabSize: 2,
};

export const outputCodePrismTheme: Record<string, CSSProperties> = {
  'code[class*="language-"]': baseCodeStyle,
  'pre[class*="language-"]': {
    ...baseCodeStyle,
    margin: 0,
    padding: 0,
    overflow: 'auto',
  },
  comment: { color: MUTED, fontStyle: 'italic' },
  prolog: { color: MUTED },
  doctype: { color: MUTED },
  cdata: { color: MUTED },
  punctuation: { color: MUTED },
  entity: { color: TEXT },
  'attr-name': { color: CYAN },
  'class-name': { color: CYAN },
  boolean: { color: LIME },
  constant: { color: LIME },
  number: { color: LIME },
  atrule: { color: CYAN },
  keyword: { color: CYAN },
  property: { color: CYAN },
  tag: { color: MAGENTA },
  symbol: { color: MAGENTA },
  deleted: { color: MAGENTA },
  important: { color: MAGENTA },
  selector: { color: LIME },
  string: { color: LIME },
  char: { color: LIME },
  builtin: { color: CYAN },
  inserted: { color: LIME },
  regex: { color: LIME },
  'attr-value': { color: LIME },
  variable: { color: TEXT },
  operator: { color: MUTED },
  function: { color: CYAN },
  url: { color: CYAN },
  'script.language-javascript': { color: TEXT },
  'script.language-jsx': { color: TEXT },
};

export const OUTPUT_CODE_PANEL_BG = '#080808';
