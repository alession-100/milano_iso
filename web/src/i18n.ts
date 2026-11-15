export type Lang = 'it' | 'en';

export const DEFAULT_LANG: Lang = 'it';

export const dictionary = {
  it: {
    title: 'Milano Iso',
    attribution: 'Attribuzione: segnaposto (le fonti dati reali arriveranno più avanti)',
  },
  en: {
    title: 'Milano Iso',
    attribution: 'Attribution: placeholder (real data sources will be added later)',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type Key = keyof (typeof dictionary)['it'];

export function t(key: Key, lang: Lang = DEFAULT_LANG): string {
  return dictionary[lang][key];
}
