import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUpdaterModule } from './updater/testing/updater-test-module-loader'

const {
  appMock,
  fetchNudgeMock,
  powerMonitorOnMock,
  autoUpdaterMock,
  fetchNewerReleaseTagsMock,
  moduleFactories,
  resetUpdaterMocks
} = await vi.hoisted(async () =>
  (await import('./updater/testing/updater-test-harness')).createUpdaterMocks()
)

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./updater/electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('./ipc/pty/provider/kill-all', () => moduleFactories.ptyKillAll())
vi.mock('./updater/linux-package/linux-update-package-type', () =>
  moduleFactories.linuxUpdatePackageType()
)
vi.mock('./updater/updater-lifecycle-diagnostics', () =>
  moduleFactories.updaterLifecycleDiagnostics()
)
vi.mock('./updater/releases/updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./updater/nudges/nudge-campaign', () => moduleFactories.updaterNudge())
vi.mock('./updater/update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./updater/releases/updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('./updater/mac-install/macos-shipit-scheduling', () =>
  moduleFactories.macosShipItScheduling()
)
vi.mock('./local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('./local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())

import { CUSTOM_UPDATE_INSTRUCTIONS } from '../shared/custom-update-policy'

describe('custom build update policy', () => {
  beforeEach(() => {
    resetUpdaterMocks()
    appMock.getVersion.mockReturnValue('1.0.60+custom.2')
    vi.useFakeTimers()
  })

  async function startUpdater() {
    fetchNewerReleaseTagsMock.mockResolvedValue({ tags: ['v1.0.61'], state: 'ready' })
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => autoUpdaterMock.emit('update-available', { version: '1.0.61' }))
      return Promise.resolve(undefined)
    })
    const send = vi.fn()
    const updater = await loadUpdaterModule()
    const mainWindowMock = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: { isDestroyed: vi.fn().mockReturnValue(false), send }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Updater setup only uses these mocked BrowserWindow methods.
    updater.setupAutoUpdater(mainWindowMock as never)
    return { updater, send }
  }

  it('advertises manual update support before updater setup finishes', async () => {
    const updater = await loadUpdaterModule()

    expect(updater.getRemoteServerUpdateSupport()).toMatchObject({
      automatic: false,
      reason: 'manual-service-update-required'
    })
  })

  it('never checks in the background, polls nudges, or installs on quit', async () => {
    const { updater } = await startUpdater()
    updater.checkForUpdates()
    appMock.emit('browser-window-focus')
    await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(fetchNudgeMock).not.toHaveBeenCalled()
    expect(powerMonitorOnMock).not.toHaveBeenCalledWith('resume', expect.anything())
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
    expect(updater.getRemoteServerUpdateSupport()).toMatchObject({
      automatic: false,
      reason: 'manual-service-update-required'
    })
  })

  it('reports manual offers with instructions and never schedules follow-up checks', async () => {
    const { updater } = await startUpdater()
    updater.checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.getUpdateStatus()).toMatchObject({
      state: 'available',
      version: '1.0.61',
      manualUpdateInstructions: CUSTOM_UPDATE_INSTRUCTIONS
    })
    expect(updater.getRemoteServerUpdaterSnapshot('runtime').status).toMatchObject({
      manualUpdateInstructions: CUSTOM_UPDATE_INSTRUCTIONS
    })
    await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('reports manual checks that find no upstream update', async () => {
    const { updater } = await startUpdater()
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => autoUpdaterMock.emit('update-not-available'))
      return Promise.resolve(undefined)
    })
    updater.checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.getUpdateStatus()).toMatchObject({
      state: 'not-available',
      userInitiated: true,
      manualUpdateInstructions: CUSTOM_UPDATE_INSTRUCTIONS
    })
  })

  it('reports manual check failures without retrying automatically', async () => {
    const { updater } = await startUpdater()
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      return Promise.reject(new Error('net::ERR_FAILED'))
    })
    updater.checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.getUpdateStatus()).toMatchObject({
      state: 'error',
      userInitiated: true,
      message: expect.stringContaining("Couldn't reach the update server"),
      manualUpdateInstructions: CUSTOM_UPDATE_INSTRUCTIONS
    })
    await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('does not retry a manual prerelease check when its manifest is missing', async () => {
    const { updater } = await startUpdater()
    fetchNewerReleaseTagsMock.mockResolvedValue({
      tags: ['v1.0.61-rc.1', 'v1.0.60'],
      state: 'ready'
    })
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      return Promise.reject(new Error('404 latest.yml'))
    })
    updater.checkForUpdatesFromMenu({ includePrerelease: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.getUpdateStatus()).toMatchObject({
      state: 'error',
      userInitiated: true
    })
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('blocks direct download and install calls', async () => {
    const { updater, send } = await startUpdater()
    updater.checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)
    updater.downloadUpdate()
    updater.quitAndInstall()
    await vi.advanceTimersByTimeAsync(1000)
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('updater:quitAndInstallAborted')
    expect(updater.getUpdateStatus()).toMatchObject({
      state: 'error',
      message: CUSTOM_UPDATE_INSTRUCTIONS,
      retryable: false
    })
  })

  it('keeps background checks for upstream builds', async () => {
    appMock.getVersion.mockReturnValue('1.0.60')
    await startUpdater()
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
  })
})
