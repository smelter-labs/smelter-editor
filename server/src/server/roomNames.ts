export type RoomNameEntry = {
  pl: string;
  en: string;
};

export const ROOM_NAMES: RoomNameEntry[] = [
  { pl: 'Kuchnia', en: 'Kitchen' },
  { pl: 'Salon', en: 'Living Room' },
  { pl: 'Spiżarka', en: 'Pantry' },
  { pl: 'Wychodek', en: 'Outhouse' },
  { pl: 'Piwnica', en: 'Basement' },
  { pl: 'Strych', en: 'Attic' },
  { pl: 'Łazienka', en: 'Bathroom' },
  { pl: 'Garaż', en: 'Garage' },
  { pl: 'Komórka', en: 'Storage Closet' },
  { pl: 'Schowek', en: 'Hideaway' },
  { pl: 'Balkon', en: 'Balcony' },
  { pl: 'Taras', en: 'Terrace' },
  { pl: 'Korytarz', en: 'Hallway' },
  { pl: 'Jadalnia', en: 'Dining Room' },
  { pl: 'Sypialnia', en: 'Bedroom' },
  { pl: 'Gabinet', en: 'Study' },
  { pl: 'Przedpokój', en: 'Foyer' },
  { pl: 'Weranda', en: 'Porch' },
  { pl: 'Pralnia', en: 'Laundry Room' },
  { pl: 'Kotłownia', en: 'Boiler Room' },
  { pl: 'Biblioteka', en: 'Library' },
  { pl: 'Oranżeria', en: 'Orangery' },
  { pl: 'Suterena', en: 'Cellar' },
  { pl: 'Alkowa', en: 'Alcove' },
  { pl: 'Garderoba', en: 'Walk-in Closet' },
  { pl: 'Pracownia', en: 'Workshop' },
  { pl: 'Składzik', en: 'Cubbyhole' },
  { pl: 'Antresola', en: 'Mezzanine' },
  { pl: 'Kredens', en: 'Sideboard Nook' },
  { pl: 'Zimny Pokój', en: 'Cold Room' },
];

export function pickUniqueRoomName(usedNames: Set<string>): RoomNameEntry {
  const available = ROOM_NAMES.filter(entry => !usedNames.has(entry.pl));
  if (available.length === 0) {
    const suffix = usedNames.size + 1;
    return { pl: `Pokój #${suffix}`, en: `Room #${suffix}` };
  }
  const idx = Math.floor(Math.random() * available.length);
  return available[idx];
}
