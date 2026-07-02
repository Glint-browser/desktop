import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Tag the document with the OS so the chrome can place window controls
// correctly (traffic lights on the left for macOS, the min/max/close overlay on
// the right for Windows/Linux).
const platform = window.browser?.platform ?? 'darwin'
document.body.classList.add(
  platform === 'win32' ? 'platform-win' : platform === 'darwin' ? 'platform-mac' : 'platform-linux'
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
