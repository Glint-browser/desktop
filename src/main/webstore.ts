/**
 * Chrome Web Store integration: a script injected into chromewebstore.google.com
 * pages that rebrands the "Add to Chrome" button to "Add to Glint" and, on
 * click, reports the extension's page URL back to the main process via a
 * console-message marker (tab pages have no IPC bridge). The main process then
 * downloads and installs the .crx and shows an in-page toast.
 */

export const WEBSTORE_MARKER = '__GLINT_INSTALL__'

export const WEBSTORE_HOOK_SCRIPT = `(() => {
  if (window.__glintStore) return; window.__glintStore = 1;

  // "Add to Chrome" in the locales the store is likely to serve here.
  const ADD_RE = /(add to|legg til i|lägg till i|føj til|lisää selaimeen)\\s+(chrome|glint)/i;

  const isInstallButton = (el) => el && ADD_RE.test(el.textContent || '');

  // Cosmetic: swap the word Chrome -> Glint inside install buttons, re-enable
  // buttons the store disabled (Glint installs regardless of the store's
  // browser sniffing), and drop its "unavailable" warning banner.
  const rebrand = () => {
    for (const btn of document.querySelectorAll('button')) {
      if (!isInstallButton(btn)) continue;
      btn.disabled = false;
      btn.removeAttribute('aria-disabled');
      const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (/chrome/i.test(node.nodeValue)) {
          node.nodeValue = node.nodeValue.replace(/chrome/gi, 'Glint');
        }
      }
    }
    // Hide the "installation unavailable" banner — carefully. Match only an
    // element whose own text IS the banner message, then climb only through
    // wrappers that contain nothing else, and never hide anything tall
    // (a match inside the page's main section must not blank the page).
    for (const el of document.querySelectorAll('div, section, p, span')) {
      const t = (el.textContent || '').trim();
      if (t.length > 200 || !/currently unavailable|troubleshooting guide/i.test(t)) continue;
      let target = el;
      while (
        target.parentElement &&
        target.parentElement !== document.body &&
        (target.parentElement.textContent || '').trim().length <= t.length + 40
      ) {
        target = target.parentElement;
      }
      if (target.offsetHeight > 0 && target.offsetHeight < 160) target.style.display = 'none';
      break;
    }
  };

  // Intercept install clicks before the store's own handler runs. Use the
  // composed event path so buttons whose innards live in shadow DOM still
  // resolve to the hosting <button>.
  document.addEventListener('click', (e) => {
    const path = e.composedPath ? e.composedPath() : [];
    let el = path.find((n) => n && n.tagName === 'BUTTON');
    if (!el) {
      // Google Material renders an invisible "touch target" DIV *over* the
      // real button (as a sibling), so clicks never hit the button itself.
      // Walk a few ancestors up from the click and look for an install
      // button contained within.
      let p = e.target;
      for (let i = 0; p && i < 3; i++) {
        const btn = p.querySelector && [...p.querySelectorAll('button')].find(isInstallButton);
        if (btn) { el = btn; break; }
        p = p.parentElement;
      }
    }
    if (!isInstallButton(el)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    console.log('${WEBSTORE_MARKER} ' + location.href);
  }, true);

  // The store is a SPA — keep rebranding as it re-renders.
  new MutationObserver(rebrand).observe(document.documentElement, {
    subtree: true,
    childList: true
  });
  rebrand();
})();`

/** In-page toast reporting the install result. */
export function toastScript(message: string, ok: boolean): string {
  const color = ok ? '#1b8a4c' : '#c0392b'
  return `(() => {
    const el = document.createElement('div');
    el.textContent = ${JSON.stringify(message)};
    el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);' +
      'z-index:2147483647;background:${color};color:#fff;font:14px/1.4 system-ui;' +
      'padding:10px 18px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);' +
      'transition:opacity .4s;pointer-events:none';
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 3200);
    setTimeout(() => el.remove(), 3800);
  })();`
}

export function isWebStoreUrl(url: string): boolean {
  try {
    return new URL(url).hostname === 'chromewebstore.google.com'
  } catch {
    return false
  }
}

/**
 * Google sign-in rejects Electron ("This browser or app may not be secure")
 * when the client claims to be Chrome but fails Chrome-integrity probes. The
 * accepted workaround (used by Electron-based browsers generally) is to
 * present as Firefox on the sign-in pages only — Google's strict checks are
 * Chrome-specific. Keep in sync with TabManager's per-tab UA swap.
 */
export const FIREFOX_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0'

export const GOOGLE_LOGIN_HOSTS = ['accounts.google.com', 'accounts.youtube.com']

/**
 * Session-wide request-header fixes. One handler for everything: Electron
 * keeps only the LAST onBeforeSendHeaders listener per session, so all header
 * tweaks must live together.
 *
 * - Web Store: strip sec-ch-ua client hints (they brand us as bare Chromium,
 *   which disables installs) so it trusts the Chrome-like UA string.
 * - Google sign-in: send the Firefox UA and no client hints.
 */
export function fixSessionHeaders(ses: Electron.Session): void {
  const urls = [
    'https://chromewebstore.google.com/*',
    ...GOOGLE_LOGIN_HOSTS.map((h) => `https://${h}/*`)
  ]
  ses.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    const headers = { ...details.requestHeaders }
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase().startsWith('sec-ch-ua')) delete headers[k]
    }
    try {
      if (GOOGLE_LOGIN_HOSTS.includes(new URL(details.url).hostname)) {
        headers['User-Agent'] = FIREFOX_UA
      }
    } catch {
      // unparsable URL — leave headers as-is
    }
    callback({ requestHeaders: headers })
  })
}
