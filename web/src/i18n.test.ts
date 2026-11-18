import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LANG,
  type Lang,
  dictionary,
  getLang,
  initialLang,
  onLangChange,
  parseLangParam,
  setLang,
  t,
} from './i18n';

describe('i18n', () => {
  afterEach(() => setLang(DEFAULT_LANG));

  it('has the same key set for it and en', () => {
    expect(Object.keys(dictionary.it).sort()).toEqual(Object.keys(dictionary.en).sort());
  });
  it('has a non-empty string for every key in both languages', () => {
    for (const lang of ['it', 'en'] as const) {
      for (const [key, value] of Object.entries(dictionary[lang])) {
        expect(typeof value, `${lang}.${key}`).toBe('string');
        expect(value.trim(), `${lang}.${key}`).not.toBe('');
      }
    }
  });
  it('translates: the two languages differ for every key except the ones that are the same word', () => {
    // Words that are the same in Italian and English (a name, or a loan word), by key.
    const same = new Set(['title', 'debugTitle', 'benchmark']);
    for (const key of Object.keys(dictionary.it) as (keyof typeof dictionary.it)[]) {
      if (same.has(key)) continue;
      expect(dictionary.it[key], key).not.toBe(dictionary.en[key]);
    }
  });
  it('has the partial-load notice in both languages', () => {
    expect(t('tilesPartial', 'it')).toBe('Alcune zone della mappa non sono state caricate');
    expect(t('tilesPartial', 'en')).toBe('Some map areas could not be loaded');
  });
  it('defaults to Italian', () => {
    expect(DEFAULT_LANG).toBe('it');
    expect(getLang()).toBe('it');
    expect(t('dataLabel')).toBe('Dati');
    expect(t('dataLabel', 'en')).toBe('Data');
  });
  it('parses ?lang= and ignores anything else', () => {
    expect(parseLangParam('?lang=en')).toBe('en');
    expect(parseLangParam('?e2e=1&lang=it')).toBe('it');
    expect(parseLangParam('?lang=fr')).toBeNull();
    expect(parseLangParam('')).toBeNull();
    expect(initialLang('?lang=en')).toBe('en');
    expect(initialLang('')).toBe('it'); // no window here: no stored choice
  });
  it('setLang switches what t() returns and tells the listeners once per change', () => {
    const seen: Lang[] = [];
    const off = onLangChange(() => seen.push(getLang()));
    setLang('en');
    setLang('en'); // no change, no call
    expect(t('layers')).toBe('Layers');
    setLang('it');
    expect(t('layers')).toBe('Livelli');
    off();
    setLang('en');
    expect(seen).toEqual(['en', 'it']);
  });
});

// --- no user-facing string bypasses i18n ---
//
// A grep-based check over the DOM code of web/src: a string literal assigned to textContent, title,
// placeholder, alt, innerText or an aria attribute, or appended as text, must go through t().
// Everything else in the code (ids, class names, CSS, event names, console messages, key names) is
// not user-facing and is not matched.
//
// ALLOW-LIST: the literals below are the only ones allowed to stay as they are, each with its reason.

interface Allowed {
  file: string;
  literal: string;
  why: string;
}
const ALLOWED: Allowed[] = [
  { file: 'pick/card.ts', literal: '×', why: 'close glyph; the accessible name and the tooltip come from t("close")' },
  { file: 'main.ts', literal: '×', why: 'close glyph of the tiles notice; its aria-label comes from t("close")' },
  { file: 'debug.ts', literal: '×', why: 'close glyph of the ?debug overlay; its aria-label comes from t("close")' },
  { file: 'tiles/attribution.ts', literal: ': ', why: 'punctuation after the label, which is passed in already translated' },
  { file: 'tiles/attribution.ts', literal: ' · ', why: 'separator between attribution entries (data)' },
  { file: 'debug.ts', literal: 'fps)', why: 'developer numbers of the ?debug overlay (technical, not UI text)' },
  { file: 'debug.ts', literal: 'fps mean', why: 'developer numbers of the ?debug overlay (technical, not UI text)' },
];

/** Whole-line patterns that put a literal in front of a user. Group 2 is the quoted literal. */
const SINKS: RegExp[] = [
  /\b(?:textContent|innerText|innerHTML|placeholder|ariaLabel)\s*[:=]\s*(['"`])((?:\\.|(?!\1).)*)\1/,
  /\.(?:title|alt)\s*=\s*(['"`])((?:\\.|(?!\1).)*)\1/,
  /setAttribute\(\s*['"](?:aria-label|aria-description|aria-placeholder|aria-roledescription|aria-valuetext|title|placeholder|alt)['"]\s*,\s*(['"`])((?:\\.|(?!\1).)*)\1/,
  /\b(?:append|prepend|createTextNode)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}

export function findBypasses(file: string, text: string, allowed: readonly Allowed[] = ALLOWED): string[] {
  const rel = file.split(path.sep).join('/');
  const found: string[] = [];
  const lines = text.split('\n');
  lines.forEach((line, n) => {
    let code = line.replace(/\/\/.*$/, ''); // a trailing comment is not code
    // An assignment that continues on the next line (`x.textContent =` then the literal).
    if (/[=:(]\s*$/.test(code)) code += ' ' + (lines[n + 1] ?? '').trim();
    for (const re of SINKS) {
      const m = re.exec(code);
      if (!m) continue;
      const literal = m[2];
      if (literal === '') continue; // clearing a field shows nothing
      if (literal.startsWith('${t(')) continue; // a template that starts with a translated string
      if (allowed.some((a) => rel.endsWith(a.file) && literal.includes(a.literal))) continue;
      found.push(`${rel}:${n + 1}: ${line.trim()}`);
    }
  });
  return found;
}

describe('no UI string bypasses i18n', () => {
  it('the matcher catches the usual ways of writing a literal into the DOM', () => {
    const bad = [
      "el.textContent = 'Close';",
      "b.setAttribute('aria-label', 'Close');",
      "input.placeholder = 'Search';",
      "const x = el('span', { textContent: 'Hello' });",
      'panel.append(`Dati: `);',
      "node.title = 'Tip';",
    ];
    for (const line of bad) expect(findBypasses('src/x.ts', line), line).toHaveLength(1);
    const good = [
      "el.textContent = t('close');",
      "b.setAttribute('aria-label', t('close'));",
      'el.textContent = `${t("tilesError")}: ${message}`;',
      "el.textContent = name; // a variable",
      "el.className = 'close';",
    ];
    for (const line of good) expect(findBypasses('src/x.ts', line), line).toHaveLength(0);
  });

  it('finds no literal user-facing string in web/src outside the allow-list', () => {
    const root = path.resolve(process.cwd(), 'src');
    const found = sourceFiles(root).flatMap((f) => findBypasses(path.relative(root, f), readFileSync(f, 'utf-8')));
    expect(found).toEqual([]);
  });

  it('every allow-list entry is still needed (no stale entries)', () => {
    const root = path.resolve(process.cwd(), 'src');
    for (const a of ALLOWED) {
      const text = readFileSync(path.join(root, a.file), 'utf-8');
      const without = ALLOWED.filter((x) => x !== a);
      expect(findBypasses(a.file, text, without).length, `${a.file}: ${a.literal}`).toBeGreaterThan(0);
    }
  });
});
