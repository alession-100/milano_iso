export type Lang = 'it' | 'en';

export const DEFAULT_LANG: Lang = 'it';

export const dictionary = {
  it: {
    title: 'Milano Iso',
    mapLabel:
      'Mappa isometrica di Milano. Frecce per spostare, più e meno per lo zoom, zero per ripristinare la vista, Q ed E per ruotare.',
    dataLabel: 'Dati',
    tilesError: 'Impossibile caricare i dati della mappa',
    tilesPartial: 'Alcune zone della mappa non sono state caricate',
    debugTitle: 'Debug',
    benchmark: 'Benchmark',
    close: 'Chiudi',
    benchRunning: 'Benchmark in corso (10 s)...',
    nightMode: 'Notte',
    rotateLeft: 'Ruota a sinistra',
    rotateRight: 'Ruota a destra',
    cardUnnamed: 'Senza nome',
    cardType: 'Tipo',
    cardHeight: 'Altezza',
    cardHeightSource: "Fonte dell'altezza",
    cardOsmLink: 'Apri su OpenStreetMap',
    cardLoading: 'Caricamento dei dettagli...',
    cardLandmarkNote: 'I dettagli aggiunti al modello (guglie, pinnacoli, coperture) sono stilizzati: non provengono dai dati rilevati.',
    cardTitleFallback: 'Dettagli elemento',
    toolbarLabel: 'Strumenti della mappa',
    searchLabel: 'Cerca sulla mappa',
    searchPlaceholder: 'Cerca un luogo',
    searchResults: 'Risultati della ricerca',
    searchCount: '{n} risultati',
    searchNone: 'Nessun risultato',
    searchLoading: 'Caricamento dell’indice...',
    searchError: 'Impossibile caricare l’indice di ricerca',
    kindBuilding: 'Edificio',
    kindStreet: 'Via',
    kindGreen: 'Verde',
    kindWater: 'Acqua',
    kindLandmark: 'Punto di riferimento',
    kindStop: 'Fermata',
    layers: 'Livelli',
    layersTitle: 'Livelli della mappa',
    layerBuildings: 'Edifici',
    layerTrees: 'Alberi',
    layerMarkings: 'Segnaletica stradale',
    layerRoads: 'Strade e ferrovia',
    layerWaterGreen: 'Acqua e verde',
    layerLandmarkDetails: 'Dettagli dei monumenti',
    minimapButton: 'Mappa',
    minimapLabel: 'Panoramica della mappa: il poligono mostra la zona visibile. Per spostarsi con la tastiera usare la ricerca.',
    langSwitchText: 'EN',
    langSwitchLabel: 'Passa all’inglese (English)',
    helpButton: 'Aiuto',
    helpTitle: 'Comandi da tastiera della mappa',
    helpPan: 'Frecce: sposta la mappa',
    helpZoom: 'Più e meno: avvicina e allontana',
    helpReset: 'Zero: ripristina la vista',
    helpRotate: 'Q ed E: ruota la mappa a sinistra e a destra',
    helpEscape: 'Esc: chiude la scheda e i risultati della ricerca',
    helpTab: 'Tab: passa da un comando all’altro',
  },
  en: {
    title: 'Milano Iso',
    mapLabel: 'Isometric map of Milan. Arrow keys pan, plus and minus zoom, zero resets the view, Q and E rotate.',
    dataLabel: 'Data',
    tilesError: 'Could not load the map data',
    tilesPartial: 'Some map areas could not be loaded',
    debugTitle: 'Debug',
    benchmark: 'Benchmark',
    close: 'Close',
    benchRunning: 'Benchmark running (10 s)...',
    nightMode: 'Night',
    rotateLeft: 'Rotate left',
    rotateRight: 'Rotate right',
    cardUnnamed: 'Unnamed',
    cardType: 'Type',
    cardHeight: 'Height',
    cardHeightSource: 'Height source',
    cardOsmLink: 'View on OpenStreetMap',
    cardLoading: 'Loading details...',
    cardLandmarkNote: 'The details added to the model (spires, pinnacles, roofs) are stylised: they do not come from the surveyed data.',
    cardTitleFallback: 'Feature details',
    toolbarLabel: 'Map tools',
    searchLabel: 'Search the map',
    searchPlaceholder: 'Search a place',
    searchResults: 'Search results',
    searchCount: '{n} results',
    searchNone: 'No results',
    searchLoading: 'Loading the index...',
    searchError: 'Could not load the search index',
    kindBuilding: 'Building',
    kindStreet: 'Street',
    kindGreen: 'Green area',
    kindWater: 'Water',
    kindLandmark: 'Landmark',
    kindStop: 'Stop',
    layers: 'Layers',
    layersTitle: 'Map layers',
    layerBuildings: 'Buildings',
    layerTrees: 'Trees',
    layerMarkings: 'Road markings',
    layerRoads: 'Roads and rail',
    layerWaterGreen: 'Water and green areas',
    layerLandmarkDetails: 'Landmark details',
    minimapButton: 'Overview',
    minimapLabel: 'Overview map: the polygon shows the visible area. To move with the keyboard, use search.',
    langSwitchText: 'IT',
    langSwitchLabel: 'Switch to Italian (Italiano)',
    helpButton: 'Help',
    helpTitle: 'Map keyboard shortcuts',
    helpPan: 'Arrow keys: pan the map',
    helpZoom: 'Plus and minus: zoom in and out',
    helpReset: 'Zero: reset the view',
    helpRotate: 'Q and E: rotate the map left and right',
    helpEscape: 'Esc: close the card and the search results',
    helpTab: 'Tab: move between the controls',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type Key = keyof (typeof dictionary)['it'];

/** The language in use (T-5.4); t() without a language reads it. */
let current: Lang = DEFAULT_LANG;
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function t(key: Key, lang: Lang = current): string {
  return dictionary[lang][key];
}

/** localStorage key of the remembered language. */
export const LANG_STORAGE_KEY = 'milano-iso.lang';

function asLang(v: string | null | undefined): Lang | null {
  return v === 'it' || v === 'en' ? v : null;
}

/** ?lang=it or ?lang=en; anything else (or absent) is null. */
export function parseLangParam(search: string): Lang | null {
  return asLang(new URLSearchParams(search).get('lang'));
}

export function readStoredLang(): Lang | null {
  try {
    return asLang(window.localStorage.getItem(LANG_STORAGE_KEY));
  } catch {
    return null; // storage blocked: not an error
  }
}

export function storeLang(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // storage blocked: the choice is simply not remembered
  }
}

/** Initial language: the URL wins, then the remembered choice, then Italian. */
export function initialLang(search: string): Lang {
  return parseLangParam(search) ?? readStoredLang() ?? DEFAULT_LANG;
}

/** Calls fn after every language change; returns the unsubscribe function. */
export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Switches the language: html lang follows, the listeners re-label their UI, and the choice
 * is remembered when remember is set (a click, not the ?lang= parameter).
 */
export function setLang(lang: Lang, remember = false): void {
  const changed = lang !== current;
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  if (remember) storeLang(lang);
  if (changed) for (const fn of [...listeners]) fn();
}
