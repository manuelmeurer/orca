import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { parseArgs, validateCommandAndFlags } from '../args'
import { COMMAND_SPECS } from '../specs'
import { TERMINAL_HANDLERS } from './terminal'
import { TERMINAL_CREATE_POSITION_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import { TerminalCreateParams } from '../../shared/rpc-contract/terminal-unary-params'

function setup(supported = true, reachable = true, remote = false) {
  const call = vi.fn().mockResolvedValue({ result: { terminal: { handle: 'term_new' } } })
  const client = {
    call,
    isRemote: remote,
    getCliStatus: vi.fn().mockResolvedValue({
      result: {
        runtime: {
          reachable,
          capabilities: supported ? [TERMINAL_CREATE_POSITION_RUNTIME_CAPABILITY] : []
        }
      }
    })
  }
  const create = (position: string | boolean | undefined, command?: string, focus = false) => {
    const flags = new Map<string, string | boolean>([['worktree', 'folder:folder-1']])
    if (position !== undefined) {
      flags.set('position', position)
    }
    if (command) {
      flags.set('command', command)
    }
    if (focus) {
      flags.set('focus', true)
    }
    return TERMINAL_HANDLERS['terminal create']({
      flags,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This handler uses only the three client members supplied above.
      client: client as unknown as RuntimeClient,
      cwd: '/workspace',
      json: true
    })
  }
  return { call, client, create }
}

afterEach(() => vi.restoreAllMocks())

describe('terminal create --position first', () => {
  it('accepts the flag through the public command parser', () => {
    const parsed = parseArgs(['terminal', 'create', '--command', 'codex', '--position', 'first'])
    expect(() => validateCommandAndFlags(COMMAND_SPECS, parsed)).not.toThrow()
    expect(parsed.flags.get('position')).toBe('first')
  })
  it.each([undefined, 'codex'])(
    'passes placement for command %s without taking focus',
    async (command) => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const { create, call } = setup()
      await create('first', command)
      expect(call).toHaveBeenCalledWith(
        'terminal.create',
        expect.objectContaining({
          position: 'first',
          command,
          focus: false,
          worktree: 'folder:folder-1'
        })
      )
      expect(TerminalCreateParams.parse(call.mock.calls[0][1]).position).toBe('first')
    }
  )

  it('preserves explicit focus and remote workspace selection', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { create, call } = setup(true, true, true)
    await create('first', 'codex', true)
    expect(call).toHaveBeenCalledWith(
      'terminal.create',
      expect.objectContaining({
        position: 'first',
        focus: true,
        presentation: 'focused',
        worktree: 'folder:folder-1'
      })
    )
  })

  it.each(['last', '', true])('rejects invalid position %s before creating', async (position) => {
    const { create, call } = setup()
    await expect(create(position)).rejects.toThrow()
    expect(call).not.toHaveBeenCalled()
  })

  it.each([
    [false, true, 'incompatible_runtime'],
    [true, false, 'runtime_unavailable']
  ])('refuses unsupported or unavailable hosts (%s, %s)', async (supported, reachable, code) => {
    const { create, call } = setup(supported === true, reachable === true)
    await expect(create('first')).rejects.toMatchObject({ code })
    expect(call).not.toHaveBeenCalled()
  })

  it('leaves default creation compatible with old hosts', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { create, call, client } = setup(false)
    await create(undefined)
    expect(client.getCliStatus).not.toHaveBeenCalled()
    expect(call.mock.calls[0][1]).not.toHaveProperty('position')
    expect(TerminalCreateParams.safeParse({ position: 'last' }).success).toBe(false)
  })
})
