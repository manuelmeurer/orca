import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'main.css'), 'utf8')
const editorDir = join(__dirname, '../components/editor')

function rule(selector: RegExp): string {
  const match = css.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`))
  expect(match).not.toBeNull()
  return match![1]
}

const diffEditorRule = () => rule(/\.monaco-diff-editor,\s*\.monaco-diff-editor \.monaco-editor/)

function tintPercent(variable: string, decoration: string): number {
  const match = diffEditorRule().match(
    new RegExp(
      `--vscode-diffEditor-${variable}:\\s*color-mix\\(\\s*in srgb,\\s*var\\(--git-decoration-${decoration}\\) (\\d+)%`
    )
  )
  expect(match).not.toBeNull()
  return Number(match![1])
}

describe('Monaco diff contrast', () => {
  it('keeps stacked line and character tints faint', () => {
    expect(tintPercent('insertedLineBackground', 'added')).toBeLessThanOrEqual(10)
    expect(tintPercent('insertedTextBackground', 'added')).toBeLessThanOrEqual(10)
    expect(tintPercent('removedLineBackground', 'deleted')).toBeLessThanOrEqual(12)
    expect(tintPercent('removedTextBackground', 'deleted')).toBeLessThanOrEqual(12)
  })

  it('leaves gutter tints to Monaco fallbacks', () => {
    expect(diffEditorRule()).not.toMatch(/diffEditorGutter/)
  })

  it('marks changed lines with a bar at the start of the code', () => {
    expect(rule(/\.monaco-diff-editor \.line-insert/)).toMatch(
      /box-shadow:\s*inset 3px 0 0 var\(--git-decoration-added\)/
    )
    expect(rule(/\.monaco-diff-editor \.line-delete/)).toMatch(
      /box-shadow:\s*inset 3px 0 0 var\(--git-decoration-deleted\)/
    )
  })

  it('dims inline deleted lines', () => {
    expect(rule(/\.monaco-diff-editor \.view-lines\.line-delete \.view-line/)).toMatch(
      /opacity:\s*0\.6/
    )
  })

  it.each(['DiffViewer.tsx', 'DiffSectionBody.tsx'])('hides the +/- indicators in %s', (file) => {
    expect(readFileSync(join(editorDir, file), 'utf8')).toMatch(/renderIndicators: false/)
  })
})
