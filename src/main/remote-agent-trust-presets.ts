import { posix, win32 } from 'node:path'
import type { AgentTrustPreset } from './agent-trust-presets'
import { upsertProjectTrustLevelInContent } from './codex/config-toml-trust'
import { getActiveMultiplexer } from './ssh/ssh-target-registry'
import { getSshFilesystemProvider } from './providers/ssh-filesystem-dispatch'
import type { IFilesystemProvider } from './providers/types'
import {
  isWindowsAbsolutePathLike,
  normalizeRuntimePathSeparators
} from '../shared/cross-platform-path'

export async function markRemoteAgentWorkspaceTrusted(args: {
  preset: AgentTrustPreset
  connectionId: string
  workspacePath: string
}): Promise<void> {
  const home = await resolveRemoteHome(args.connectionId)
  const filesystem = getSshFilesystemProvider(args.connectionId)
  if (!home || !filesystem) {
    return
  }

  const workspacePath = await canonicalizeRemoteWorkspacePath(filesystem, args.workspacePath)
  if (args.preset === 'codex') {
    await markRemoteCodexProjectTrusted(filesystem, home, workspacePath)
  } else if (args.preset === 'cursor') {
    await markRemoteCursorWorkspaceTrusted(filesystem, home, workspacePath)
  } else if (args.preset === 'copilot') {
    await markRemoteCopilotFolderTrusted(filesystem, home, workspacePath)
  }
}

async function resolveRemoteHome(connectionId: string): Promise<string | null> {
  const multiplexer = getActiveMultiplexer(connectionId)
  if (!multiplexer || multiplexer.isDisposed?.()) {
    return null
  }
  const result = await multiplexer.request('session.resolveHome', { path: '~' })
  const resolvedPath =
    result && typeof result === 'object' && 'resolvedPath' in result
      ? result.resolvedPath
      : undefined
  const home =
    typeof resolvedPath === 'string' ? normalizeRuntimePathSeparators(resolvedPath.trim()) : ''
  return home &&
    (home.startsWith('/') || isWindowsAbsolutePathLike(home)) &&
    !hasRemotePathControlCharacter(home)
    ? home.replace(/\/$/, '')
    : null
}

function hasRemotePathControlCharacter(value: string): boolean {
  return value.includes(String.fromCharCode(0)) || value.includes('\r') || value.includes('\n')
}

function joinRemotePath(basePath: string, ...parts: string[]): string {
  const path = isWindowsAbsolutePathLike(basePath) ? win32 : posix
  return normalizeRuntimePathSeparators(path.join(basePath, ...parts))
}

async function canonicalizeRemoteWorkspacePath(
  filesystem: IFilesystemProvider,
  workspacePath: string
): Promise<string> {
  try {
    return await filesystem.realpath(workspacePath)
  } catch {
    return workspacePath
  }
}

async function readRemoteTextFile(
  filesystem: IFilesystemProvider,
  filePath: string
): Promise<string> {
  try {
    const result = await filesystem.readFile(filePath)
    return result.isBinary ? '' : result.content
  } catch {
    return ''
  }
}

async function markRemoteCodexProjectTrusted(
  filesystem: IFilesystemProvider,
  remoteHome: string,
  workspacePath: string
): Promise<void> {
  const codexDirectory = joinRemotePath(remoteHome, '.codex')
  const configPath = joinRemotePath(codexDirectory, 'config.toml')
  const existing = await readRemoteTextFile(filesystem, configPath)
  const updated = upsertProjectTrustLevelInContent(existing, workspacePath, 'trusted', {
    alreadyCanonical: true
  })
  if (updated === existing) {
    return
  }
  await filesystem.createDir(codexDirectory)
  await filesystem.writeFile(configPath, updated)
}

async function markRemoteCursorWorkspaceTrusted(
  filesystem: IFilesystemProvider,
  remoteHome: string,
  workspacePath: string
): Promise<void> {
  const slug = workspacePath.replace(/^[\\/]+/, '').replace(/[\\/:*?"<>|]+/g, '-')
  if (!slug) {
    return
  }
  const trustDirectory = joinRemotePath(remoteHome, '.cursor', 'projects', slug)
  const trustFile = joinRemotePath(trustDirectory, '.workspace-trusted')
  try {
    await filesystem.stat(trustFile)
    return
  } catch {
    // Missing marker: write the same shape the local trust preset writes.
  }
  await filesystem.createDir(trustDirectory)
  await filesystem.writeFile(
    trustFile,
    `${JSON.stringify({ trustedAt: new Date().toISOString(), workspacePath }, null, 2)}\n`
  )
}

async function markRemoteCopilotFolderTrusted(
  filesystem: IFilesystemProvider,
  remoteHome: string,
  workspacePath: string
): Promise<void> {
  const configDirectory = joinRemotePath(remoteHome, '.copilot')
  const configPath = joinRemotePath(configDirectory, 'config.json')
  const raw = await readRemoteTextFile(filesystem, configPath)
  let config: Record<string, unknown> = {}
  if (raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        config = Object.fromEntries(Object.entries(parsed))
      }
    } catch {
      return
    }
  }
  const existing = Array.isArray(config.trustedFolders) ? config.trustedFolders : []
  if (existing.includes(workspacePath)) {
    return
  }
  config.trustedFolders = [...existing.filter((entry) => typeof entry === 'string'), workspacePath]
  await filesystem.createDir(configDirectory)
  await filesystem.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
}
