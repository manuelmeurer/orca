// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store'
import { TooltipProvider } from '../ui/tooltip'
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

beforeEach(() => {
  useAppStore.setState({
    updateStatus: {
      state: 'available',
      version: '1.4.208',
      changelog: null,
      manualUpdateInstructions: CUSTOM_UPDATE_INSTRUCTIONS
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
  render(
    <TooltipProvider>
      <GeneralUpdateSettingsSection />
    </TooltipProvider>
  )

  expect(screen.getByText(/Install with bin\/orca-custom install/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Download update|Restart to update/i })).toBeNull()
  expect(screen.getByRole('link', { name: 'Release notes' })).toBeTruthy()
  expect((await screen.findByTestId('update-delay-setting')).getAttribute('data-recheck')).toBe(
    'false'
  )
})

it('shows custom installer instructions below the release history in settings', () => {
  useAppStore.setState({
    updateStatus: {
      state: 'available',
      version: '1.4.208',
      changelog: null,
      manualUpdateInstructions: CUSTOM_UPDATE_INSTRUCTIONS,
      releaseHistory: {
        installedVersion: '1.4.207+custom.2',
        newerReleaseCount: 1,
        releases: [
          {
            version: '1.4.208',
            publishedAt: '2026-11-20T10:00:00Z',
            notes: 'Faster startup',
            releaseUrl: 'https://github.com/stablyai/orca/releases/tag/v1.4.208'
          }
        ]
      }
    }
  })
  render(
    <TooltipProvider>
      <GeneralUpdateSettingsSection />
    </TooltipProvider>
  )

  const pagerLink = screen.getByRole('button', { name: 'View on GitHub' })
  const instructions = screen.getByText(CUSTOM_UPDATE_INSTRUCTIONS)
  expect(
    pagerLink.compareDocumentPosition(instructions) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
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
