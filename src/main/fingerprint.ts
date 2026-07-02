import { app, session, type WebContents } from 'electron'

export interface FpProfile {
  userAgent: string
  platform: string
  hardwareConcurrency: number
  deviceMemory: number
  languages: string[]
  screen: { width: number; height: number; colorDepth: number }
  webglVendor: string
  webglRenderer: string
  noiseSeed: number
}

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

// Advertise the *real* engine version — an old/fake Chrome version makes sites
// (Google's especially) serve legacy or broken code paths. Identity variety
// comes from platform/screen/GPU/canvas noise instead.
const CHROME_VERSION = `${process.versions.chrome.split('.')[0]}.0.0.0`
const CHROME = [CHROME_VERSION]

// Sites that break under JS spoofing and gain nothing from it: the Web Store
// needs a coherent identity to serve the install flow, and Google sign-in
// treats canvas/UA inconsistencies as "insecure browser" and blocks login.
const EXEMPT_HOSTS = [
  'chromewebstore.google.com',
  'accounts.google.com',
  'accounts.youtube.com'
]
const PLATFORMS = [
  {
    platform: 'Win32',
    ua: (v: string) =>
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`
  },
  {
    platform: 'MacIntel',
    ua: (v: string) =>
      `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`
  }
]
const SCREENS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 2560, height: 1440 },
  { width: 1440, height: 900 }
]
const GPUS = [
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630, D3D11)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, D3D11)' },
  { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)' }
]

export function generateProfile(): FpProfile {
  const version = pick(CHROME)
  const plat = pick(PLATFORMS)
  const gpu = pick(GPUS)
  return {
    userAgent: plat.ua(version),
    platform: plat.platform,
    hardwareConcurrency: pick([4, 8, 12, 16]),
    deviceMemory: pick([4, 8, 16]),
    languages: pick([['en-US', 'en'], ['en-GB', 'en'], ['en-US']]),
    screen: { ...pick(SCREENS), colorDepth: 24 },
    webglVendor: gpu.vendor,
    webglRenderer: gpu.renderer,
    noiseSeed: (Math.random() * 0xffffffff) >>> 0
  }
}

let profile = generateProfile()
let enabled = false

/** Enable/disable spoofing. UA is session-wide; JS patches are injected per tab. */
export function setFingerprintEnabled(on: boolean): void {
  enabled = on
  session.defaultSession.setUserAgent(on ? profile.userAgent : app.userAgentFallback)
}

/** Make a fresh random identity (call to "reroll" the fingerprint). */
export function regenerateProfile(): void {
  profile = generateProfile()
  if (enabled) session.defaultSession.setUserAgent(profile.userAgent)
}

/**
 * Inject the spoofing script at document-start (page main world) via CDP, so it
 * runs before any page script reads the fingerprint. No-op when disabled.
 */
export function applyToWebContents(wc: WebContents): void {
  if (!enabled) return
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    wc.debugger
      .sendCommand('Page.enable')
      .then(() =>
        wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
          source: buildScript(profile)
        })
      )
      .catch(() => {})
  } catch {
    // debugger busy (e.g. DevTools attached) — skip injection for this tab
  }
}

/** The spoofing source that runs in each page before its own scripts. */
function buildScript(p: FpProfile): string {
  return `(() => { try {
    if (${JSON.stringify(EXEMPT_HOSTS)}.includes(location.hostname)) return;
    const P = ${JSON.stringify(p)};
    const def = (o, k, v) => { try { Object.defineProperty(o, k, { get: () => v, configurable: true }); } catch (e) {} };
    def(Navigator.prototype, 'platform', P.platform);
    def(Navigator.prototype, 'hardwareConcurrency', P.hardwareConcurrency);
    def(Navigator.prototype, 'deviceMemory', P.deviceMemory);
    def(Navigator.prototype, 'languages', Object.freeze(P.languages.slice()));
    def(Navigator.prototype, 'language', P.languages[0]);
    def(Navigator.prototype, 'userAgentData', undefined);
    def(Screen.prototype, 'width', P.screen.width);
    def(Screen.prototype, 'height', P.screen.height);
    def(Screen.prototype, 'availWidth', P.screen.width);
    def(Screen.prototype, 'availHeight', P.screen.height - 40);
    def(Screen.prototype, 'colorDepth', P.screen.colorDepth);
    def(Screen.prototype, 'pixelDepth', P.screen.colorDepth);
    const patchGL = (proto) => {
      if (!proto) return;
      const gp = proto.getParameter;
      proto.getParameter = function (x) {
        if (x === 37445) return P.webglVendor;   // UNMASKED_VENDOR_WEBGL
        if (x === 37446) return P.webglRenderer; // UNMASKED_RENDERER_WEBGL
        return gp.call(this, x);
      };
    };
    patchGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
    patchGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
    let seed = P.noiseSeed >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed & 1; };
    const noise = (data) => { for (let i = 0; i < data.length; i += 1223 * 4) data[i] ^= rnd(); };
    const origGID = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (...a) {
      const img = origGID.apply(this, a); noise(img.data); return img;
    };
    const origTDU = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...a) {
      try {
        const ctx = this.getContext('2d');
        if (ctx && this.width && this.height) {
          const img = origGID.call(ctx, 0, 0, this.width, this.height);
          noise(img.data); ctx.putImageData(img, 0, 0);
        }
      } catch (e) {}
      return origTDU.apply(this, a);
    };
  } catch (e) {} })();`
}
