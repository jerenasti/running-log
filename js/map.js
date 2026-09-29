// Maps: Leaflet (loaded from cdnjs only when a map is shown) with OpenStreetMap tiles.
// Map tiles come from tile.openstreetmap.org, so OpenStreetMap sees which area is viewed.
// In dark mode the same tiles are darkened with a CSS filter (css/components.css, .map), so no
// second map provider is needed. Route colors come from the design tokens (--route-1 … --route-5).

const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
let loading = null;

/** Load Leaflet's CSS and JS once; resolves to the global L */
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = LEAFLET + 'leaflet.min.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = LEAFLET + 'leaflet.min.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => { loading = null; reject(new Error('The map library could not be loaded. Check the internet connection.')); };
    document.head.appendChild(js);
  });
  return loading;
}

/** A map in `el` with OpenStreetMap tiles and their attribution; scroll-wheel zoom off so the page scrolls */
export function baseMap(L, el) {
  const map = L.map(el, { scrollWheelZoom: false, zoomControl: true, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  return map;
}

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Route colors from the tokens: 5 steps from low to high, the casing under the line, the heat line */
export const routeColors = () => ({
  steps: [1, 2, 3, 4, 5].map(i => cssVar(`--route-${i}`)),
  casing: cssVar('--route-casing'),
  heat: cssVar('--route-heat'),
  marker: cssVar('--text'),
  surface: cssVar('--surface'),
});
