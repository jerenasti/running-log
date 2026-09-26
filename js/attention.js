// The Overview "Needs your attention" list: most important first, only a few shown at once,
// and notes about the data itself (preliminary forecast, short history, …) grouped into one item.
// Pure logic, no DOM code.

export const MAX_VISIBLE = 3;
const ORDER = { warn: 0, watch: 1, info: 2 };

/**
 * items: [{ level: 'warn' | 'watch' | 'info', text, tab?, tabLabel?, kind?: 'data' }]
 * Returns { visible, hidden }: sorted warn > watch > info (otherwise in the order given); items with
 * kind 'data' become one "Data quality" item { kind: 'data', level (the highest of them), notes: [texts] }.
 */
export function organizeAttention(items, max = MAX_VISIBLE) {
  const data = items.filter(i => i.kind === 'data');
  const rest = items.filter(i => i.kind !== 'data');
  if (data.length) {
    const level = data.map(i => i.level).sort((a, b) => ORDER[a] - ORDER[b])[0];
    rest.push({ kind: 'data', level, text: 'Data quality', notes: data.map(i => i.text) });
  }
  // Array.prototype.sort is stable, so items of the same level keep their order
  const sorted = rest.map((item, i) => ({ item, i }))
    .sort((a, b) => ORDER[a.item.level] - ORDER[b.item.level] || a.i - b.i)
    .map(x => x.item);
  return { visible: sorted.slice(0, max), hidden: sorted.slice(max) };
}
