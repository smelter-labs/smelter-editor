const NUMBER_WORDS: Record<string, string> = {
  one: '1',
  first: '1',
  two: '2',
  second: '2',
  three: '3',
  third: '3',
  free: '3',
  four: '4',
  fourth: '4',
  five: '5',
  fifth: '5',
  six: '6',
  sixth: '6',
  seven: '7',
  seventh: '7',
  eight: '8',
  eighth: '8',
  nine: '9',
  ninth: '9',
  ten: '10',
  tenth: '10',
  eleven: '11',
  eleventh: '11',
  twelve: '12',
  twelfth: '12',
};

const POLITE_WORDS = [
  'please',
  'could you',
  'would you',
  'can you',
  'kindly',
  'thanks',
  'thank you',
];

const PHRASE_ALIASES: [RegExp, string][] = [
  [/\bscreen\s*share\b/gi, 'screenshare'],
  [/\bshare\s*screen\b/gi, 'screenshare'],
  [/\bremove\s*colour\b/gi, 'remove color'],
  [/\bgr[ae]y\s*scale\b/gi, 'grayscale'],
  [/\bholo\b/gi, 'hologram'],
  [/\btelegram\b/gi, 'hologram'],
  [/\bphotogram\b/gi, 'hologram'],
  [/\beffect\b/gi, 'shader'],
  [/\bthe\s*select\b/gi, 'deselect'],
  [/\b(light|flight|slide)\b/gi, 'layout'],
];

const INPUT_ALIASES = ['feed', 'source', 'inputs'];

export function normalize(text: string): string {
  let result = text.toLowerCase();

  result = result.replace(/[^\w\s]/g, ' ');

  result = result.replace(/\s+/g, ' ').trim();

  for (const word of POLITE_WORDS) {
    result = result.replace(new RegExp(`\\b${word}\\b`, 'gi'), '');
  }

  for (const [pattern, replacement] of PHRASE_ALIASES) {
    result = result.replace(pattern, replacement);
  }

  for (const [word, num] of Object.entries(NUMBER_WORDS)) {
    result = result.replace(new RegExp(`\\b${word}\\b`, 'gi'), num);
  }

  for (const alias of INPUT_ALIASES) {
    result = result.replace(
      new RegExp(`\\b${alias}\\s+(\\d+)\\b`, 'gi'),
      'input $1',
    );
  }

  result = result.replace(/\binput\s+number\s+(\d+)\b/gi, 'input $1');

  result = result.replace(/\b(\d+)\s+input\b/gi, 'input $1');

  result = result.replace(/\s+/g, ' ').trim();

  return result;
}
