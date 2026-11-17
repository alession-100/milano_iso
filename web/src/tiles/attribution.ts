import { type AttributionEntry, attributionUrl } from './manifest';

/**
 * Fill `el` with "<label>: <entry> · <entry>", each entry a link where a URL is known.
 * Text only (no innerHTML), so manifest strings cannot inject markup.
 */
export function renderAttribution(
  el: HTMLElement,
  entries: AttributionEntry[],
  label: string,
): void {
  el.replaceChildren();
  el.append(`${label}: `);
  entries.forEach((entry, n) => {
    if (n > 0) el.append(' · ');
    const url = attributionUrl(entry);
    if (url === undefined) {
      el.append(entry.text);
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.textContent = entry.text;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    el.append(a);
  });
}
