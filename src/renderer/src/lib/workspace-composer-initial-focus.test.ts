// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { getWorkspaceComposerInitialFocusTarget } from './workspace-composer-initial-focus'

describe('getWorkspaceComposerInitialFocusTarget', () => {
  it('focuses the project combobox when both name and project triggers exist', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <button role="combobox" data-project-combobox-root="true"></button>
      <input data-workspace-name-input="true" />
    `

    expect(getWorkspaceComposerInitialFocusTarget(root)).toBe(
      root.querySelector('[data-project-combobox-root="true"]')
    )
  })

  it('prefers the project combobox over the source pill', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <button role="combobox" data-project-combobox-root="true"></button>
      <div data-workspace-source-pill="true" tabindex="0"></div>
    `

    expect(getWorkspaceComposerInitialFocusTarget(root)).toBe(
      root.querySelector('[data-project-combobox-root="true"]')
    )
  })

  it('ignores the project combobox wrapper that is not the trigger', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-project-combobox-root="true">
        <button role="combobox" data-project-combobox-root="true"></button>
      </div>
    `

    expect(getWorkspaceComposerInitialFocusTarget(root)).toBe(
      root.querySelector('[role="combobox"]')
    )
  })

  it('prefers project focus over legacy repo trigger', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <button role="combobox" data-repo-combobox-root="true"></button>
      <button role="combobox" data-project-combobox-root="true"></button>
    `

    expect(getWorkspaceComposerInitialFocusTarget(root)).toBe(
      root.querySelector('[data-project-combobox-root="true"]')
    )
  })

  it('falls back to the legacy repo combobox before the name input', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <input data-workspace-name-input="true" />
      <button role="combobox" data-repo-combobox-root="true"></button>
    `

    expect(getWorkspaceComposerInitialFocusTarget(root)).toBe(
      root.querySelector('[data-repo-combobox-root="true"]')
    )
  })

  it('falls back to the workspace name input without a project picker', () => {
    const root = document.createElement('div')
    const nameInput = document.createElement('input')
    nameInput.setAttribute('data-workspace-name-input', 'true')
    root.append(nameInput)

    expect(getWorkspaceComposerInitialFocusTarget(root)).toBe(nameInput)
  })

  it('falls back to the source pill without a project picker or name input', () => {
    const root = document.createElement('div')
    const pill = document.createElement('div')
    pill.setAttribute('data-workspace-source-pill', 'true')
    pill.setAttribute('tabindex', '0')
    root.append(pill)

    expect(getWorkspaceComposerInitialFocusTarget(root)).toBe(pill)
  })
})
