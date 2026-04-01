import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pickUniqueRoomName } from '../roomNames';

describe('pickUniqueRoomName', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it('returns a name from the predefined list when usedNames is empty', () => {
    const result = pickUniqueRoomName(new Set());
    expect(result.pl).toBeDefined();
    expect(result.en).toBeDefined();
    expect(typeof result.pl).toBe('string');
    expect(typeof result.en).toBe('string');
  });

  it('excludes names already in usedNames set', () => {
    const usedNames = new Set(['Kuchnia', 'Salon', 'Spiżarka']);
    randomSpy.mockReturnValue(0);
    const result = pickUniqueRoomName(usedNames);
    expect(usedNames.has(result.pl)).toBe(false);
  });

  it('returns the first available name when Math.random returns 0', () => {
    randomSpy.mockReturnValue(0);
    const result = pickUniqueRoomName(new Set());
    expect(result).toEqual({ pl: 'Kuchnia', en: 'Kitchen' });
  });

  it('returns the last available name when Math.random returns 0.999', () => {
    randomSpy.mockReturnValue(0.999);
    const result = pickUniqueRoomName(new Set());
    expect(result).toEqual({ pl: 'Zimny Pokój', en: 'Cold Room' });
  });

  it('works when only one name remains available', () => {
    // Use all names except the last one
    const allNames = [
      'Kuchnia',
      'Salon',
      'Spiżarka',
      'Wychodek',
      'Piwnica',
      'Strych',
      'Łazienka',
      'Garaż',
      'Komórka',
      'Schowek',
      'Balkon',
      'Taras',
      'Korytarz',
      'Jadalnia',
      'Sypialnia',
      'Gabinet',
      'Przedpokój',
      'Weranda',
      'Pralnia',
      'Kotłownia',
      'Biblioteka',
      'Oranżeria',
      'Suterena',
      'Alkowa',
      'Garderoba',
      'Pracownia',
      'Składzik',
      'Antresola',
      'Kredens',
      // Leave out 'Zimny Pokój'
    ];
    const usedNames = new Set(allNames);
    const result = pickUniqueRoomName(usedNames);
    expect(result).toEqual({ pl: 'Zimny Pokój', en: 'Cold Room' });
  });

  it('returns fallback "Pokój #N" / "Room #N" when all 30 names are exhausted', () => {
    const allNames = new Set([
      'Kuchnia',
      'Salon',
      'Spiżarka',
      'Wychodek',
      'Piwnica',
      'Strych',
      'Łazienka',
      'Garaż',
      'Komórka',
      'Schowek',
      'Balkon',
      'Taras',
      'Korytarz',
      'Jadalnia',
      'Sypialnia',
      'Gabinet',
      'Przedpokój',
      'Weranda',
      'Pralnia',
      'Kotłownia',
      'Biblioteka',
      'Oranżeria',
      'Suterena',
      'Alkowa',
      'Garderoba',
      'Pracownia',
      'Składzik',
      'Antresola',
      'Kredens',
      'Zimny Pokój',
    ]);
    const result = pickUniqueRoomName(allNames);
    expect(result.pl).toBe('Pokój #31');
    expect(result.en).toBe('Room #31');
  });

  it('fallback suffix equals usedNames.size + 1', () => {
    // 30 predefined names + 5 extra fallbacks already used
    const allNames = new Set([
      'Kuchnia',
      'Salon',
      'Spiżarka',
      'Wychodek',
      'Piwnica',
      'Strych',
      'Łazienka',
      'Garaż',
      'Komórka',
      'Schowek',
      'Balkon',
      'Taras',
      'Korytarz',
      'Jadalnia',
      'Sypialnia',
      'Gabinet',
      'Przedpokój',
      'Weranda',
      'Pralnia',
      'Kotłownia',
      'Biblioteka',
      'Oranżeria',
      'Suterena',
      'Alkowa',
      'Garderoba',
      'Pracownia',
      'Składzik',
      'Antresola',
      'Kredens',
      'Zimny Pokój',
      'Pokój #31',
      'Pokój #32',
      'Pokój #33',
      'Pokój #34',
      'Pokój #35',
    ]);
    const result = pickUniqueRoomName(allNames);
    expect(result.pl).toBe(`Pokój #${allNames.size + 1}`);
    expect(result.en).toBe(`Room #${allNames.size + 1}`);
  });
});
