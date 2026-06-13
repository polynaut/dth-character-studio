import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import { join } from 'node:path'

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  utilityProcess,
  type UtilityProcess,
} from 'electron'

/** Dev loads the web dev server with HMR; production boots the bundled web server. */
const DEV = import.meta.env.DEV
const DEV_URL = process.env.DTH_WEB_URL ?? 'http://localhost:4330'

let webServer: UtilityProcess | null = null
let mainWindow: BrowserWindow | null = null

/** Per-user data folder — kept out of the app bundle so it survives updates. */
function dataDir(): string {
  return join(app.getPath('userData'), 'data')
}

/**
 * Locate the web app's production server entry (apps/web/server/index.js).
 * Packaged builds copy apps/web into resources/web; running from source uses
 * the monorepo layout (apps/desktop → ../web).
 */
function resolveWebEntry(): string {
  const candidates = [
    join(process.resourcesPath, 'web', 'server', 'index.js'),
    join(app.getAppPath(), '..', 'web', 'server', 'index.js'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`Web server entry not found. Looked in:\n  ${candidates.join('\n  ')}`)
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

function waitForPort(port: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = connect(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() > deadline) reject(new Error(`Web server never came up on :${port}`))
        else setTimeout(attempt, 150)
      })
    }
    attempt()
  })
}

/** Fork the web app's own server (same code path as `pnpm --filter @dth/web start`). */
async function startWebServer(): Promise<string> {
  const entry = resolveWebEntry()
  const port = await getFreePort()
  webServer = utilityProcess.fork(entry, [], {
    stdio: 'pipe',
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DTH_DATA_DIR: dataDir(),
      NODE_ENV: 'production',
    },
  })
  webServer.stdout?.on('data', (chunk) => process.stdout.write(`[web] ${chunk}`))
  webServer.stderr?.on('data', (chunk) => process.stderr.write(`[web] ${chunk}`))
  await waitForPort(port)
  return `http://127.0.0.1:${port}`
}

function registerBridge(): void {
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('dialog:pickFbx', async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined
    const result = await dialog.showOpenDialog(parent!, {
      title: 'Select reference skeleton FBX',
      properties: ['openFile'],
      filters: [
        { name: 'FBX files', extensions: ['fbx'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    return result.canceled || result.filePaths.length === 0 ? '' : result.filePaths[0]
  })

  ipcMain.handle('app:openDataDir', async () => {
    const dir = dataDir()
    await mkdir(dir, { recursive: true })
    return shell.openPath(dir)
  })
}

async function createWindow(): Promise<void> {
  const url = DEV ? DEV_URL : await startWebServer()

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Open external links in the real browser, not inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) {
      shell.openExternal(target)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  await mainWindow.loadURL(url)
  if (DEV) mainWindow.webContents.openDevTools({ mode: 'detach' })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    registerBridge()
    void createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('quit', () => {
    webServer?.kill()
    webServer = null
  })
}
