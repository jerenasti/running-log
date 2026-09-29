// A confirmation dialog in the app's own style (instead of the browser's confirm()).
// Uses <dialog>: focus moves into it, Esc cancels, and focus returns to where it was.

import { esc } from '../format.js';

/**
 * Ask before doing something. Resolves true (confirmed) or false (cancelled).
 * details: optional [label, value] rows shown as a small table (e.g. route name and length)
 */
export function confirmDialog({ title, text = '', details = [], confirm = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    const back = document.activeElement;
    const d = document.createElement('dialog');
    d.className = 'app-dialog';
    d.setAttribute('aria-labelledby', 'appDialogTitle');
    d.innerHTML = `
      <form method="dialog">
        <h2 id="appDialogTitle">${esc(title)}</h2>
        ${text ? `<p>${esc(text)}</p>` : ''}
        ${details.length ? `<dl class="dialog-details">${details.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd>`).join('')}</dl>` : ''}
        <div class="row-actions dialog-actions">
          <button type="submit" value="cancel" class="btn">${esc(cancel)}</button>
          <button type="submit" value="ok" class="btn primary${danger ? ' danger' : ''}">${esc(confirm)}</button>
        </div>
      </form>`;
    document.body.appendChild(d);
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      if (d.open) d.close();
      d.remove();
      back?.focus?.();
      resolve(ok);
    };
    // The answer comes from the button itself (not only the dialog's close event, which some browsers skip)
    d.querySelector('form').addEventListener('submit', e => { e.preventDefault(); finish(e.submitter?.value === 'ok'); });
    d.addEventListener('cancel', e => { e.preventDefault(); finish(false); });   // Esc
    d.addEventListener('close', () => finish(d.returnValue === 'ok'));
    d.showModal();
    d.querySelector('button[value="cancel"]').focus();   // the safe choice has focus first
  });
}
