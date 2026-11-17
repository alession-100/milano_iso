/**
 * Adds `el` to the page just before the attribution, so the tab order is: toolbar, map, the
 * controls at the right, the info card, attribution (T-5.4). Without an attribution it is appended.
 */
export function mountBeforeAttribution(el: HTMLElement): void {
  const attribution = document.getElementById('attribution');
  if (attribution?.parentNode === document.body) document.body.insertBefore(el, attribution);
  else document.body.appendChild(el);
}
