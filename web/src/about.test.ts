import { describe, expect, it } from 'vitest';
import { ABOUT_SOURCES, REPO_URL } from './about';
import { dictionary } from './i18n';

describe('About sources', () => {
  it('lists OpenStreetMap, as hard rule 10 asks, with its licence page', () => {
    const osm = ABOUT_SOURCES.find((s) => s.name.includes('OpenStreetMap'));
    expect(osm?.licence).toBe('ODbL 1.0');
    expect(osm?.licenceUrl).toBe('https://www.openstreetmap.org/copyright');
  });
  it('gives every source a licence, https links and strings in both languages', () => {
    for (const s of ABOUT_SOURCES) {
      expect(s.licence.trim()).not.toBe('');
      expect(s.licenceUrl).toMatch(/^https:\/\//);
      expect(s.sourceUrl).toMatch(/^https:\/\//);
      for (const lang of ['it', 'en'] as const) {
        expect(dictionary[lang][s.useKey].length).toBeGreaterThan(0);
        expect(dictionary[lang][s.dateKey].length).toBeGreaterThan(0);
      }
    }
  });
  it('links to the repository', () => {
    expect(REPO_URL).toBe('https://github.com/alession-100/milano_iso');
  });
});
