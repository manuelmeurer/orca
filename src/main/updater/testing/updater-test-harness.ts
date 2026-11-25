import { vi } from 'vitest'

type EventListener = (...args: unknown[]) => void

export function createUpdaterMocks() {
  const appListeners = new Map<string, EventListener[]>()
  const updaterListeners = new Map<string, EventListener[]>()
  const powerMonitorOnMock = vi.fn()
  const fetchNudgeMock = vi.fn().mockResolvedValue(null)
  const fetchNewerReleaseTagsMock = vi.fn()
  const getLinuxPackageTypeMock = vi.fn(() => 'non-root' as const)

  const appMock = {
    isPackaged: true,
    getVersion: vi.fn().mockReturnValue('1.0.60'),
    on: vi.fn((event: string, listener: EventListener) => {
      appListeners.set(event, [...(appListeners.get(event) ?? []), listener])
    }),
    prependListener: vi.fn((event: string, listener: EventListener) => {
      appListeners.set(event, [listener, ...(appListeners.get(event) ?? [])])
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of appListeners.get(event) ?? []) {
        listener(...args)
      }
    }
  }

  const autoUpdaterMock = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    autoRunAppAfterInstall: true,
    allowDowngrade: false,
    disableDifferentialDownload: false,
    allowPrerelease: false,
    logger: undefined,
    on: vi.fn((event: string, listener: EventListener) => {
      updaterListeners.set(event, [...(updaterListeners.get(event) ?? []), listener])
      return autoUpdaterMock
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of updaterListeners.get(event) ?? []) {
        listener(...args)
      }
    },
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn()
  }

  const resetUpdaterMocks = (): void => {
    appListeners.clear()
    updaterListeners.clear()
    appMock.isPackaged = true
    appMock.getVersion.mockReset().mockReturnValue('1.0.60')
    appMock.on.mockClear()
    appMock.prependListener.mockClear()
    autoUpdaterMock.autoInstallOnAppQuit = true
    autoUpdaterMock.autoRunAppAfterInstall = true
    autoUpdaterMock.autoDownload = false
    autoUpdaterMock.allowDowngrade = false
    autoUpdaterMock.disableDifferentialDownload = false
    autoUpdaterMock.allowPrerelease = false
    autoUpdaterMock.on.mockClear()
    autoUpdaterMock.setFeedURL.mockReset()
    autoUpdaterMock.checkForUpdates.mockReset().mockResolvedValue(undefined)
    autoUpdaterMock.downloadUpdate.mockReset().mockResolvedValue(undefined)
    autoUpdaterMock.quitAndInstall.mockReset()
    powerMonitorOnMock.mockReset()
    fetchNudgeMock.mockReset().mockResolvedValue(null)
    fetchNewerReleaseTagsMock.mockReset()
    getLinuxPackageTypeMock.mockReset().mockReturnValue('non-root')
  }

  const moduleFactories = {
    electron: () => ({
      app: appMock,
      autoUpdater: autoUpdaterMock,
      net: { fetch: vi.fn() },
      powerMonitor: { on: powerMonitorOnMock },
      shell: { showItemInFolder: vi.fn() },
      ipcMain: { on: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() }
    }),
    electronUpdater: () => ({ autoUpdater: autoUpdaterMock }),
    electronUpdaterLoader: () => ({ loadElectronAutoUpdater: () => autoUpdaterMock }),
    ptyKillAll: () => ({ killAllPty: vi.fn() }),
    linuxUpdatePackageType: () => ({
      getLinuxPackageType: getLinuxPackageTypeMock,
      getLinuxRootPackageType: vi.fn().mockReturnValue('deb'),
      isExternallyManagedLinuxInstall: vi.fn().mockReturnValue(false)
    }),
    updaterLifecycleDiagnostics: () => ({ recordUpdaterLifecycle: vi.fn() }),
    updaterChangelog: () => ({ fetchChangelog: vi.fn().mockResolvedValue(null) }),
    updaterNudge: () => ({ fetchNudge: fetchNudgeMock, shouldApplyNudge: vi.fn() }),
    macosShipItScheduling: () => ({ configureMacShipItScheduling: vi.fn() }),
    updateInstallExitWatchdog: () => ({
      armUpdateInstallExitWatchdog: vi.fn(),
      disarmUpdateInstallExitWatchdog: vi.fn()
    }),
    updaterPrereleaseFeed: () => ({
      fetchLatestStableReleaseTag: vi.fn().mockResolvedValue(null),
      fetchNewerReleaseTagsWithReadiness: fetchNewerReleaseTagsMock
    }),
    localBuildSwitch: () => ({ chooseLocalBuild: vi.fn().mockResolvedValue(null) }),
    localBuildFeedServer: () => ({ startLocalBuildFeed: vi.fn() })
  }

  return {
    appMock,
    autoUpdaterMock,
    fetchNudgeMock,
    fetchNewerReleaseTagsMock,
    getLinuxPackageTypeMock,
    moduleFactories,
    powerMonitorOnMock,
    resetUpdaterMocks
  }
}
