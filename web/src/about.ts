import { type Key, onLangChange, t } from './i18n';

/** The source code of the project (docs/PROGRESS.md, header). */
export const REPO_URL = 'https://github.com/alession-100/milano_iso';

export interface AboutSource {
  /** Name and licence are data (like the attribution entries): they are not translated. */
  name: string;
  licence: string;
  /** The page that states the licence, from docs/DATA_SOURCES.md. */
  licenceUrl: string;
  /** The page of the dataset itself, from docs/DATA_SOURCES.md. */
  sourceUrl: string;
  useKey: Key;
  dateKey: Key;
}

/**
 * The sources the map is built from, with the pages recorded in docs/DATA_SOURCES.md (rows 1, 3b, 4a).
 * The on-screen attribution line comes from the tile manifest; this list is the long form.
 */
export const ABOUT_SOURCES: readonly AboutSource[] = [
  {
    name: 'OpenStreetMap contributors',
    licence: 'ODbL 1.0',
    licenceUrl: 'https://www.openstreetmap.org/copyright',
    sourceUrl: 'https://download.geofabrik.de/europe/italy/nord-ovest.html',
    useKey: 'aboutUseOsm',
    dateKey: 'aboutDateOsm',
  },
  {
    name: 'Comune di Milano, Database Topografico (DBT) 2020',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://dati.comune.milano.it/dataset/ds2889_database-topografico-dbt-2020-shp',
    sourceUrl: 'https://dati.comune.milano.it/dataset/ds2889_database-topografico-dbt-2020-shp',
    useKey: 'aboutUseDbt',
    dateKey: 'aboutDateDbt',
  },
  {
    name: 'Comune di Milano, confini amministrativi',
    licence: 'CC BY',
    licenceUrl: 'https://dati.comune.milano.it/dataset/ds2841-confini-amministrativi-del-comune-di-milano',
    sourceUrl: 'https://dati.comune.milano.it/dataset/ds2841-confini-amministrativi-del-comune-di-milano',
    useKey: 'aboutUseBoundary',
    dateKey: 'aboutDateBoundary',
  },
];

/** Elements made inert while the About dialog is open (everything but the attribution). */
const BACKGROUND_IDS = ['app', 'toolbar-zone', 'mode-toggle', 'rotation-controls', 'info-card', 'debug-overlay'];

export interface About {
  /** The button for the attribution line. */
  button: HTMLButtonElement;
  /** Puts the button at the end of the attribution line (called again after each re-render of the line). */
  attach: () => void;
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<'id' | 'className' | 'textContent', string>> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  return e;
}

function link(href: string, text: string): HTMLAnchorElement {
  const a = el('a', { textContent: text });
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/**
 * The About dialog (T-7.2): what the map is, the sources with their licences, the date of the data,
 * the build and the repository. It is a modal dialog above the map and below the attribution band:
 * the overlay stops at the band, so the attribution is never covered, and the rest of the page is
 * inert while it is open. Escape closes it from anywhere and focus goes back to where it was; Tab
 * leaves it into the attribution and the browser, so it is not a keyboard trap. It has its own
 * language button because the toolbar is inert while it is open.
 */
export function createAbout(onLang: () => void): About {
  const button = el('button', { id: 'about-button' });
  button.type = 'button';
  button.className = 'tb-btn';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'about-overlay');

  const overlay = el('div', { id: 'about-overlay' });
  overlay.hidden = true;
  const panel = el('section', { id: 'about-panel' });
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'about-title');
  panel.tabIndex = -1;
  const head = el('div', { className: 'about-head' });
  const title = el('h2', { id: 'about-title' });
  const langBtn = el('button', { id: 'about-lang' });
  langBtn.type = 'button';
  langBtn.className = 'tb-btn';
  langBtn.addEventListener('click', onLang);
  const closeBtn = el('button', { id: 'about-close' });
  closeBtn.type = 'button';
  closeBtn.className = 'tb-btn';
  head.append(title, langBtn, closeBtn);
  const what = el('p');
  const sourcesTitle = el('h3');
  const list = el('ul', { className: 'about-sources' });
  const rows = ABOUT_SOURCES.map((src) => {
    const li = el('li');
    const name = el('strong', { textContent: src.name });
    const use = el('p');
    const licence = el('p');
    const licenceLabel = el('span');
    licence.append(licenceLabel, link(src.licenceUrl, src.licence));
    const date = el('p');
    const page = el('p');
    const pageLink = link(src.sourceUrl, '');
    page.append(pageLink);
    li.append(name, use, licence, date, page);
    list.append(li);
    return { src, use, licenceLabel, date, pageLink };
  });
  const version = el('p', { className: 'about-meta' });
  const repoPara = el('p');
  const repoLink = link(REPO_URL, '');
  repoPara.append(repoLink);
  panel.append(head, what, sourcesTitle, list, version, repoPara);
  overlay.append(panel);

  const background = (): HTMLElement[] =>
    BACKGROUND_IDS.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => e !== null);

  let returnTo: HTMLElement | null = null;
  const isOpen = (): boolean => !overlay.hidden;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  function open(): void {
    if (isOpen()) return;
    returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : button;
    overlay.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    for (const e of background()) e.inert = true;
    document.addEventListener('keydown', onKey, true);
    panel.focus();
  }
  function close(): void {
    if (!isOpen()) return;
    overlay.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    for (const e of background()) e.inert = false;
    document.removeEventListener('keydown', onKey, true);
    const back = returnTo && document.contains(returnTo) ? returnTo : button;
    returnTo = null;
    back.focus();
  }
  button.addEventListener('click', () => (isOpen() ? close() : open()));
  closeBtn.addEventListener('click', close);
  // a click on the dimmed area (not on the panel) closes it
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const apply = (): void => {
    button.textContent = t('aboutButton');
    title.textContent = t('aboutTitle');
    langBtn.textContent = t('langSwitchText');
    langBtn.setAttribute('aria-label', t('langSwitchLabel'));
    closeBtn.textContent = t('close');
    what.textContent = t('aboutWhat');
    sourcesTitle.textContent = t('aboutSources');
    for (const r of rows) {
      r.use.textContent = t(r.src.useKey);
      r.licenceLabel.textContent = `${t('aboutLicence')}: `;
      r.date.textContent = `${t('aboutDataDate')}: ${t(r.src.dateKey)}`;
      r.pageLink.textContent = t('aboutSourcePage');
    }
    version.textContent = `${t('aboutVersion')}: ${__BUILD_ID__}`;
    repoLink.textContent = t('aboutRepo');
  };
  apply();
  onLangChange(apply);

  document.body.append(overlay);
  return {
    button,
    attach: () => {
      document.getElementById('attribution')?.append(button); // append moves it to the end
    },
    isOpen,
    open,
    close,
  };
}
