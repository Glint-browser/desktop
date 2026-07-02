'use strict'

// Thin JS wrapper around the native addon. Degrades gracefully to a no-op if
// the binary is missing or fails to load (e.g. non-macOS, load error).
let addon = null
if (process.platform === 'darwin') {
  try {
    addon = require('bindings')('mouse_nav')
  } catch (err) {
    // Degrade to a no-op, but say so — a silent failure here cost us a debug
    // session once (ABI-mismatched binary loaded as null with no trace).
    console.error('[mouse-nav] native addon failed to load:', err && err.message)
    addon = null
  }
}

module.exports = {
  /** Start monitoring; `cb` is called with 'back' or 'forward'. */
  start(cb) {
    if (addon && typeof addon.start === 'function') {
      try {
        addon.start(cb)
      } catch (err) {
        /* ignore */
      }
    }
  },
  /** Stop monitoring. */
  stop() {
    if (addon && typeof addon.stop === 'function') {
      try {
        addon.stop()
      } catch (err) {
        /* ignore */
      }
    }
  },
  /** True when the native monitor is available on this platform. */
  available: !!(addon && typeof addon.start === 'function')
}
