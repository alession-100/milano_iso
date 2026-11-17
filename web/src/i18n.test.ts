import { describe, expect, it } from 'vitest';
import { DEFAULT_LANG, dictionary, t } from './i18n';

describe('i18n', () => {
  it('has the same key set for it and en', () => {
    expect(Object.keys(dictionary.it).sort()).toEqual(Object.keys(dictionary.en).sort());
  });
  it('has the partial-load notice in both languages', () => {
    expect(t('tilesPartial', 'it')).toBe('Alcune zone della mappa non sono state caricate');
    expect(t('tilesPartial', 'en')).toBe('Some map areas could not be loaded');
  });
  it('defaults to Italian', () => {
    expect(DEFAULT_LANG).toBe('it');
    expect(t('dataLabel')).toBe('Dati');
    expect(t('dataLabel', 'en')).toBe('Data');
  });
});
