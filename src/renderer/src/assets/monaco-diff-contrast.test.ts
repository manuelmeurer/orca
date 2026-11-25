import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { derivePluginMonacoTheme } from '../lib/editor/appearance/plugin-monaco-theme'
import { paintMonacoDiffColors } from '../lib/editor/appearance/monaco-diff-colors'
import type { Rgba } from '../../../shared/color/rgba-contrast'

const css = readFileSync(join(__dirname, 'main.css'), 'utf8')

function rule(selector: RegExp): string {
  const match = css.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`))
  if (!match) {
    throw new Error(`Missing CSS rule matching ${selector}`)
  }
  return match[1]
}

const builtInOnly = (side: 'inserted' | 'removed') =>
  `html:not\\(\\[data-monaco-theme-diff-${side}\\]\\)`
const diffEditorRule = (side: 'inserted' | 'removed') =>
  rule(
    new RegExp(
      `${builtInOnly(side)} \\.monaco-diff-editor,\\s*${builtInOnly(side)} \\.monaco-diff-editor \\.monaco-editor`
    )
  )

function tintPercent(side: 'inserted' | 'removed', kind: 'Line' | 'Text'): number {
  const token = side === 'inserted' ? 'diff-added' : 'diff-removed'
  const match = diffEditorRule(side).match(
    new RegExp(
      `--vscode-diffEditor-${side}${kind}Background:\\s*color-mix\\(\\s*in srgb,\\s*var\\(--${token}\\) (\\d+)%`
    )
  )
  if (!match) {
    throw new Error(`Missing ${side} ${kind} tint`)
  }
  return Number(match[1])
}

// Enough of a color parser for the hex values below.
function probe(value: string): Rgba | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (!match) {
    return null
  }
  const n = Number.parseInt(match[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
}

function editorTheme(painted: Record<string, string>) {
  const tokens: Record<string, string> = {
    '--background': '#1e1e1e',
    '--foreground': '#d4d4d4',
    '--diff-added': '#2ea043',
    '--diff-added-background': '#1d3a26',
    '--diff-added-emphasis': '#235c32',
    '--diff-added-gutter': '#2c6b3c',
    '--diff-removed': '#f85149',
    '--diff-removed-background': '#3d1f20',
    '--diff-removed-emphasis': '#6b2a2a',
    '--diff-removed-gutter': '#7a3030'
  }
  return derivePluginMonacoTheme({
    base: 'dark',
    read: (token) => tokens[token] ?? '',
    painted,
    probe
  })
}

function rootMarks(theme: ReturnType<typeof editorTheme>): string[] {
  const root = { dataset: {} as DOMStringMap }
  paintMonacoDiffColors(theme, root)
  return Object.keys(root.dataset).sort()
}

describe('Monaco diff contrast', () => {
  it('fades the stacked line and character tints from the diff tokens', () => {
    expect(tintPercent('inserted', 'Line')).toBeLessThanOrEqual(10)
    expect(tintPercent('inserted', 'Text')).toBeLessThanOrEqual(10)
    expect(tintPercent('removed', 'Line')).toBeLessThanOrEqual(12)
    expect(tintPercent('removed', 'Text')).toBeLessThanOrEqual(12)
  })

  it('scopes each side to its own mark, and sets the tints nowhere else', () => {
    const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const tintRules = [...uncommented.matchAll(/([^{}]+)\{([^}]*--vscode-diffEditor-[^}]*)\}/g)]
    expect(tintRules).toHaveLength(2)
    for (const [, selector, body] of tintRules) {
      const side = /inserted/.test(body) ? 'inserted' : 'removed'
      expect(selector.trim()).toMatch(new RegExp(`^${builtInOnly(side)}`))
      expect(body).not.toMatch(side === 'inserted' ? /removed/ : /inserted/)
    }
  })

  it('leaves gutter tints to Monaco fallbacks', () => {
    expect(diffEditorRule('inserted')).not.toMatch(/diffEditorGutter/)
    expect(diffEditorRule('removed')).not.toMatch(/diffEditorGutter/)
  })

  it('marks each side only while the editor theme paints its backgrounds', () => {
    expect(rootMarks(null)).toEqual([])
    expect(rootMarks(editorTheme({}))).toEqual([])
    // A theme with only the added hue keeps the built-in removed tints faded.
    expect(rootMarks(editorTheme({ '--diff-added': '#2ea043' }))).toEqual([
      'monacoThemeDiffInserted'
    ])
    expect(rootMarks(editorTheme({ '--diff-removed-background': '#3d1f20' }))).toEqual([
      'monacoThemeDiffRemoved'
    ])
    expect(
      rootMarks(editorTheme({ '--diff-added': '#2ea043', '--diff-removed': '#f85149' }))
    ).toEqual(['monacoThemeDiffInserted', 'monacoThemeDiffRemoved'])
  })

  it('ignores gutter and overview colors, which leave the line backgrounds built-in', () => {
    expect(
      rootMarks(
        editorTheme({ '--diff-added-gutter': '#2c6b3c', '--diff-removed-gutter': '#7a3030' })
      )
    ).toEqual([])
  })

  it('clears the marks when the editor goes back to the built-in diff colors', () => {
    const root = { dataset: {} as DOMStringMap }
    paintMonacoDiffColors(
      editorTheme({ '--diff-added': '#2ea043', '--diff-removed': '#f85149' }),
      root
    )
    paintMonacoDiffColors(null, root)
    expect(Object.keys(root.dataset)).toEqual([])
  })

  it('updates the marks with the code editor theme', () => {
    const source = readFileSync(
      join(__dirname, '../app-shell/appearance/use-document-appearance.ts'),
      'utf8'
    )
    expect(source).toMatch(/paintMonacoDiffColors\(codeEditorTheme\.monaco\)/)
  })

  it('marks changed lines with a bar at the start of the code', () => {
    expect(rule(/\.monaco-diff-editor \.line-insert/)).toMatch(
      /box-shadow:\s*inset 3px 0 0 var\(--diff-added\)/
    )
    expect(rule(/\.monaco-diff-editor \.line-delete/)).toMatch(
      /box-shadow:\s*inset 3px 0 0 var\(--diff-removed\)/
    )
  })

  it('dims inline deleted lines', () => {
    expect(rule(/\.monaco-diff-editor \.view-lines\.line-delete \.view-line/)).toMatch(
      /opacity:\s*0\.6/
    )
  })

  it.each([
    ['DiffViewer.tsx', '../components/editor/diff/monaco-view/DiffViewer.tsx'],
    ['DiffSectionBody.tsx', '../components/editor/diff/sections/DiffSectionBody.tsx']
  ])('hides the +/- indicators in %s', (_name, file) => {
    expect(readFileSync(join(__dirname, file), 'utf8')).toMatch(/renderIndicators: false/)
  })
})
