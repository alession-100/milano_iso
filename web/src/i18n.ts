export type Lang = 'it' | 'en';

export const DEFAULT_LANG: Lang = 'it';

export const dictionary = {
  it: {
    title: 'Milano Iso',
    mapLabel:
      'Mappa isometrica di Milano. Frecce per spostare, più e meno per lo zoom, zero per ripristinare la vista.',
    dataLabel: 'Dati',
    tilesError: 'Impossibile caricare i dati della mappa',
    debugTitle: 'Debug',
    benchmark: 'Benchmark',
    close: 'Chiudi',
    benchRunning: 'Benchmark in corso (10 s)...',
  },
  en: {
    title: 'Milano Iso',
    mapLabel: 'Isometric map of Milan. Arrow keys pan, plus and minus zoom, zero resets the view.',
    dataLabel: 'Data',
    tilesError: 'Could not load the map data',
    debugTitle: 'Debug',
    benchmark: 'Benchmark',
    close: 'Close',
    benchRunning: 'Benchmark running (10 s)...',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type Key = keyof (typeof dictionary)['it'];

export function t(key: Key, lang: Lang = DEFAULT_LANG): string {
  return dictionary[lang][key];
}
