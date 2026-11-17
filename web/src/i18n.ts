export type Lang = 'it' | 'en';

export const DEFAULT_LANG: Lang = 'it';

export const dictionary = {
  it: {
    title: 'Milano Iso',
    dataLabel: 'Dati',
    tilesError: 'Impossibile caricare i dati della mappa',
  },
  en: {
    title: 'Milano Iso',
    dataLabel: 'Data',
    tilesError: 'Could not load the map data',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type Key = keyof (typeof dictionary)['it'];

export function t(key: Key, lang: Lang = DEFAULT_LANG): string {
  return dictionary[lang][key];
}
