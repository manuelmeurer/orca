// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store'
import { GeneralUpdateSettingsSection } from './updates/GeneralUpdateSettingsSection'
import { CUSTOM_UPDATE_INSTRUCTIONS } from '../../../../shared/custom-update-policy'
import type { RemoteServerUpdateEntry } from '../../runtime/hosts/updates/remote-server-update-coordinator'
import { getRemoteServerManualUpdateHelp } from './runtime-environments/updates/RemoteServerUpdateStatus'

vi.mock('./updates/GeneralRemoteServerUpdates', () => ({
  GeneralRemoteServerUpdates: () => null
}))
vi.mock('./updates/ReleaseChannelSection', () => ({ ReleaseChannelSection: () => null }))
vi.mock('./updates/UpdateDelaySetting', () => ({
  UpdateDelaySetting: ({ recheckOnDelayChange }: { recheckOnDelayChange?: boolean }) => (
    <span data-testid="update-delay-setting" data-recheck={String(recheckOnDelayChange)} />
  )
}))

const manualUpdateInstructions =
  'Run bin/orca-custom install from the orca-custom repository. A custom build for this upstream release may not be available yet.'

beforeEach(() => {
  useAppStore.setState({
    updateStatus: {
      state: 'available',
      version: '1.4.208',
      changelog: null,
      manualUpdateInstructions
    }
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { updater: { getVersion: vi.fn().mockResolvedValue('1.4.207+custom.2') } }
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState({ updateStatus: { state: 'idle' } })
})

it('shows custom installer instructions and release notes without update actions', async () => {
  render(<GeneralUpdateSettingsSection />)

  expect(screen.getByText(/Run bin\/orca-custom install/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Download update|Restart to update/i })).toBeNull()
  expect(screen.getByRole('link', { name: 'Release notes' })).toBeTruthy()
  expect((await screen.findByTestId('update-delay-setting')).getAttribute('data-recheck')).toBe(
    'false'
  )
})

it('gives paired clients the custom installer instructions for a custom server', () => {
  const entry: RemoteServerUpdateEntry = {
    environmentId: 'server',
    name: 'Custom server',
    phase: 'manual',
    currentVersion: '1.4.207+custom.2',
    targetVersion: null,
    progress: null,
    runtimeId: 'runtime',
    liveTabCount: 0,
    liveLeafCount: 0,
    support: null,
    error: null,
    managedOverSsh: true
  }

  expect(getRemoteServerManualUpdateHelp(entry)).toBe(CUSTOM_UPDATE_INSTRUCTIONS)
})
