import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUpdaterModule, warmUpdaterModule } from './updater-test-module-loader'

const {
  appMock,
  fetchNudgeMock,
  powerMonitorOnMock,
  autoUpdaterMock,
  fetchNewerReleaseTagsMock,
  moduleFactories,
  resetUpdaterMocks
} = await vi.hoisted(async () => (await import('./updater-test-harness')).createUpdaterMocks())

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('@electron-toolkit/utils', () => moduleFactories.electronToolkitUtils())
vi.mock('./ipc/pty', () => moduleFactories.ipcPty())
vi.mock('./linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./updater-nudge', () => moduleFactories.updaterNudge())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('./local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('./local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())

import { CUSTOM_UPDATE_INSTRUCTIONS } from '../shared/custom-update-policy'

warmUpdaterModule()

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
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Updater setup only needs the mocked window's webContents.send.
    updater.setupAutoUpdater({ webContents: { send } } as never)
    return updater
  }

  it('never checks in the background, polls nudges, or installs on quit', async () => {
    const updater = await startUpdater()
    updater.checkForUpdates()
    appMock.emit('browser-window-focus')
    await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(fetchNudgeMock).not.toHaveBeenCalled()
    expect(powerMonitorOnMock).not.toHaveBeenCalledWith('resume', expect.anything())
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
    expect(updater.getRemoteServerUpdateSupport().automatic).toBe(false)
  })

  it('reports manual offers with instructions and never schedules follow-up checks', async () => {
    const updater = await startUpdater()
    updater.checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.getUpdateStatus()).toMatchObject({
      state: 'available',
      version: '1.0.61',
      manualUpdateInstructions: CUSTOM_UPDATE_INSTRUCTIONS
    })
    await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('blocks direct download and install calls', async () => {
    const updater = await startUpdater()
    updater.checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)
    updater.downloadUpdate()
    updater.quitAndInstall()
    await vi.advanceTimersByTimeAsync(1000)
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
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
