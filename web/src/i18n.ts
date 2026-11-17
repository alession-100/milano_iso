export type Lang = 'it' | 'en';

export const DEFAULT_LANG: Lang = 'it';

export const dictionary = {
  it: {
    title: 'Milano Iso',
    mapLabel:
      'Mappa isometrica di Milano. Frecce per spostare, più e meno per lo zoom, zero per ripristinare la vista.',
    attribution: 'Attribuzione: segnaposto (le fonti dati reali arriveranno più avanti)',
  },
  en: {
    title: 'Milano Iso',
    mapLabel: 'Isometric map of Milan. Arrow keys pan, plus and minus zoom, zero resets the view.',
    attribution: 'Attribution: placeholder (real data sources will be added later)',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type Key = keyof (typeof dictionary)['it'];

export function t(key: Key, lang: Lang = DEFAULT_LANG): string {
  return dictionary[lang][key];
}
