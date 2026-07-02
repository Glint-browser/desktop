/**
 * A self-contained new-tab page served as a data: URL. It loads no network
 * resources, so opening a tab never auto-navigates to Google. The search box
 * navigates the tab itself (treats input as a URL if it looks like one, else
 * runs a Google search) by setting window.location.
 */
const HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>New Tab</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: radial-gradient(120% 120% at 50% 0%, #2a2740 0%, #1c1b22 70%);
    color: #e9e7ef;
  }
  .wrap { width: min(620px, 80vw); text-align: center; transform: translateY(-6vh); }
  .logo {
    width: 56px; height: 56px; margin: 0 auto 22px; border-radius: 16px;
    background: linear-gradient(160deg, #6d5bd0, #e0759a);
    box-shadow: 0 8px 30px rgba(109, 91, 208, 0.4);
  }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 22px; opacity: 0.9; }
  form { position: relative; }
  input {
    width: 100%; height: 52px; padding: 0 20px; font-size: 16px;
    color: #fff; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px; outline: none;
  }
  input:focus { border-color: rgba(255,255,255,0.35); background: rgba(255,255,255,0.1); }
  input::placeholder { color: #8d88a3; }
  .hint { margin-top: 14px; font-size: 12px; color: #8d88a3; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo"></div>
    <h1>Where to?</h1>
    <form id="f">
      <input id="q" autofocus placeholder="Search the web or enter an address" />
    </form>
    <div class="hint">Press Enter to search Google or open a URL</div>
  </div>
  <script>
    var f = document.getElementById('f');
    var q = document.getElementById('q');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = q.value.trim();
      if (!v) return;
      var hasScheme = /^[a-z]+:\\/\\//i.test(v);
      var looksLikeDomain = /^[^\\s]+\\.[^\\s]{2,}(\\/.*)?$/.test(v);
      if (hasScheme) window.location.href = v;
      else if (looksLikeDomain) window.location.href = 'https://' + v;
      else window.location.href = 'https://www.google.com/search?q=' + encodeURIComponent(v);
    });
  </script>
</body>
</html>`

export const NEW_TAB_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(HTML)

/** True if a page URL is our new-tab page. */
export function isNewTabUrl(url: string): boolean {
  return url.startsWith('data:text/html') && url.includes('New%20Tab')
}
