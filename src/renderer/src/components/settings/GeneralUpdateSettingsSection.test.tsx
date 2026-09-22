// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store'
import { GeneralUpdateSettingsSection } from './GeneralUpdateSettingsSection'

vi.mock('./GeneralRemoteServerUpdates', () => ({ GeneralRemoteServerUpdates: () => null }))
vi.mock('./ReleaseChannelSection', () => ({ ReleaseChannelSection: () => null }))

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
    value: { updater: { getVersion: vi.fn().mockResolvedValue('1.4.207') } }
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState({ updateStatus: { state: 'idle' } })
})

it('shows custom installer instructions and release notes without update actions', () => {
  render(<GeneralUpdateSettingsSection />)

  expect(screen.getByText(/Run bin\/orca-custom install/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Download Update|Restart to Update/ })).toBeNull()
  expect(screen.getByRole('link', { name: 'Release notes' })).toBeTruthy()
})
