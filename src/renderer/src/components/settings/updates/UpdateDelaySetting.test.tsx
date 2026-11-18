// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../store/index'
import { TooltipProvider } from '../../ui/tooltip'
import { UpdateDelaySetting } from './UpdateDelaySetting'

const updateSettings = vi.fn().mockResolvedValue(undefined)
const check = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  updateSettings.mockReset().mockResolvedValue(undefined)
  check.mockReset().mockResolvedValue(undefined)
  useAppStore.setState({
    updateSettings,
    updateStatus: { state: 'idle' }
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { updater: { check } }
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

it('does not check automatically after a custom build changes update delay', async () => {
  render(
    <TooltipProvider>
      <UpdateDelaySetting recheckOnDelayChange={false} />
    </TooltipProvider>
  )

  fireEvent.click(screen.getByRole('radio', { name: '1 day' }))
  await act(async () => {
    await Promise.resolve()
  })

  expect(updateSettings).toHaveBeenCalledWith({ updateDelayDays: 1 })
  expect(check).not.toHaveBeenCalled()
})
