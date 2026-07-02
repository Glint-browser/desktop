import { Menu, BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { TabManager } from './TabManager'
import type { UiAction } from '../shared/types'
import { IPC } from '../shared/types'

const isMac = process.platform === 'darwin'

/**
 * Build the app menu. Accelerators registered here fire even when a web page
 * (WebContentsView) has keyboard focus — which a renderer-side key listener
 * would miss. UI-only actions (the command palette) are forwarded to the
 * renderer; tab/space actions are handled directly by the TabManager.
 */
export function buildMenu(window: BrowserWindow, tabs: TabManager): void {
  const sendUi = (action: UiAction): void => window.webContents.send(IPC.UI_ACTION, action)

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ role: 'appMenu' as const }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => sendUi({ type: 'open-palette', mode: 'tab' })
        },
        {
          label: 'New Space',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => tabs.createSpace()
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => tabs.closeActiveTab()
        },
        { type: 'separator' },
        {
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: () => tabs.printActive()
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Open Location…',
          accelerator: 'CmdOrCtrl+L',
          click: () => sendUi({ type: 'open-palette', mode: 'address' })
        },
        {
          label: 'Find in Page…',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendUi({ type: 'open-find' })
        },
        {
          label: 'Toggle Split View',
          accelerator: 'CmdOrCtrl+D',
          click: () => tabs.toggleSplit()
        },
        {
          label: 'Reload Page',
          accelerator: 'CmdOrCtrl+R',
          click: () => tabs.reloadActive()
        },
        {
          label: 'Back',
          accelerator: isMac ? 'Cmd+[' : 'Alt+Left',
          click: () => tabs.backActive()
        },
        {
          label: 'Forward',
          accelerator: isMac ? 'Cmd+]' : 'Alt+Right',
          click: () => tabs.forwardActive()
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => tabs.zoomActive(0.5)
        },
        // Also accept Cmd+= (the + key without Shift) — a second accelerator.
        {
          label: 'Zoom In (=)',
          accelerator: 'CmdOrCtrl+=',
          acceleratorWorksWhenHidden: true,
          visible: false,
          click: () => tabs.zoomActive(0.5)
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => tabs.zoomActive(-0.5)
        },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => tabs.zoomActive(0)
        },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => tabs.toggleDevToolsActive()
        },
        {
          label: 'Developer Tools (F12)',
          accelerator: 'F12',
          acceleratorWorksWhenHidden: true,
          visible: false,
          click: () => tabs.toggleDevToolsActive()
        },
        {
          label: 'History…',
          accelerator: 'CmdOrCtrl+Y',
          click: () => sendUi({ type: 'open-history' })
        },
        { role: 'togglefullscreen' }
      ]
    },
    // Cmd/Ctrl+1..9 switch spaces.
    {
      label: 'Spaces',
      submenu: Array.from({ length: 9 }, (_v, i) => ({
        label: `Switch to Space ${i + 1}`,
        accelerator: `CmdOrCtrl+${i + 1}`,
        click: () => tabs.activateSpaceByIndex(i)
      }))
    },
    { role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
