import { applyRemoteViewerLaunchEnv } from './remote-viewer-launch-env'
import type { TerminalCreateOptions } from './terminal-create-options'
import type { RuntimeTerminalCreate } from '../../../../shared/runtime-terminal-create-contract'
import { randomUUID } from 'node:crypto'
import { getRuntimeDesktopSurface } from '../../runtime-desktop-surface'
import type { IpcMainEvent } from 'electron'
import { ownerSurfacing } from './terminal-presentation'
import type { OrcaRuntimeWithCreateTerminal } from './terminal-create'
import type { RuntimeTerminalPresentation } from '../../../../shared/runtime-terminal-contracts'
import type { TerminalWorkspaceCreationEvidence } from './terminal-workspace-scope'

// Without a window, the missing piece the caller can supply is the workspace, so name that.
const NO_WORKSPACE_OR_WINDOW_MESSAGE =
  'No workspace was given or found for this terminal, and this Orca host has no open app window to create one in. Pass --worktree to choose a workspace. No terminal was created.'

// Workspace-less creates target the window's current view, so only it can perform them.
export async function createDesktopTerminal(
  runtime: OrcaRuntimeWithCreateTerminal,
  worktreeSelector: string | undefined,
  opts: TerminalCreateOptions,
  presentation: RuntimeTerminalPresentation | undefined,
  rendererWindow: Electron.BrowserWindow | null,
  ...evidence: TerminalWorkspaceCreationEvidence
): Promise<RuntimeTerminalCreate> {
  runtime.assertGraphReady()
  const win = rendererWindow ?? runtime.getAuthoritativeWindow(NO_WORKSPACE_OR_WINDOW_MESSAGE)
  const [createdWorktree, resolvedWorktree, resolvedFolder] = evidence
  const workspace = worktreeSelector
    ? await runtime.resolveTerminalWorkspaceLaunchScope(
        worktreeSelector,
        createdWorktree,
        { wslUserAct: opts.wslUserAct === true },
        resolvedWorktree,
        resolvedFolder
      )
    : null
  let launchOpts = workspace
    ? await runtime.resolveAgentTerminalCreateOptions(workspace, opts)
    : opts
  if (!workspace && opts.shellOverride) {
    throw new Error(
      `--shell ${opts.shellOverride} needs a workspace, because the shell is resolved on the workspace's execution host. No terminal was created.`
    )
  }
  launchOpts = applyRemoteViewerLaunchEnv(launchOpts, launchOpts.terminalImageViewerSupported)
  const rendererWebContents = win.webContents
  const worktreeId = workspace?.id
  const cwd = workspace
    ? runtime.resolveWorkspaceTerminalStartupCwd(workspace, launchOpts.cwd)
    : launchOpts.cwd
  const requestId = randomUUID()
  const reply = await new Promise<{ tabId: string; title: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      getRuntimeDesktopSurface().removeIpcListener('terminal:tabCreateReply', handler)
      reject(new Error('Terminal creation timed out'))
    }, 10000)
    const handler = (
      event: IpcMainEvent,
      response: {
        requestId: string
        tabId?: string
        title?: string
        error?: string
      }
    ): void => {
      if (event.sender !== rendererWebContents || response.requestId !== requestId) {
        return
      }
      clearTimeout(timer)
      getRuntimeDesktopSurface().removeIpcListener('terminal:tabCreateReply', handler)
      if (response.error) {
        reject(new Error(response.error))
      } else {
        resolve({ tabId: response.tabId!, title: response.title ?? launchOpts.title ?? '' })
      }
    }
    getRuntimeDesktopSurface().onIpc('terminal:tabCreateReply', handler)
    rendererWebContents.send('terminal:requestTabCreate', {
      requestId,
      ...(worktreeId ? { worktreeId, source: 'runtime-session' as const } : {}),
      command: launchOpts.command,
      cwd,
      ...(launchOpts.env ? { env: launchOpts.env } : {}),
      ...(launchOpts.envToDelete ? { envToDelete: launchOpts.envToDelete } : {}),
      ...(launchOpts.launchConfig ? { launchConfig: launchOpts.launchConfig } : {}),
      ...(launchOpts.resumeProviderSession
        ? { resumeProviderSession: launchOpts.resumeProviderSession }
        : {}),
      ...(launchOpts.launchToken ? { launchToken: launchOpts.launchToken } : {}),
      ...(launchOpts.launchAgent ? { launchAgent: launchOpts.launchAgent } : {}),
      ...(launchOpts.viewMode ? { viewMode: launchOpts.viewMode } : {}),
      startupCommandDelivery: launchOpts.startupCommandDelivery,
      ...(launchOpts.shellOverride ? { shellOverride: launchOpts.shellOverride } : {}),
      ...(launchOpts.position ? { position: launchOpts.position } : {}),
      title: launchOpts.title,
      activate: presentation === 'focused',
      ...(presentation ? { presentation } : {}),
      ...ownerSurfacing(launchOpts.surfaceOwner !== false)
    })
  })
  const handle = await runtime.waitForTerminalHandle(reply.tabId)
  return {
    handle,
    tabId: reply.tabId,
    worktreeId: worktreeId ?? '',
    title: reply.title,
    ...runtime.getPtyExecutionHostMetadata(runtime.handles.get(handle)?.ptyId ?? null),
    surface: 'visible'
  }
}
