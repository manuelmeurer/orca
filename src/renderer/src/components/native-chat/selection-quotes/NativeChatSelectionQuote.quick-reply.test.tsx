// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { NativeChatStructuredComposerTransport } from '../composer/submit/native-chat-structured-composer-transport'
import { NativeChatComposer } from '../composer/NativeChatComposer'
import type { NativeChatComposerHandle } from '../composer/native-chat-composer-types'
import { writeNativeChatDraftCache } from '../drafts/native-chat-draft-views'
import { NativeChatSelectionQuote } from './NativeChatSelectionQuote'
import { NATIVE_CHAT_QUOTE_SOURCE_PROPS } from '../../../../../shared/native-chat/input/quotes/native-chat-quote-selection'

const PASS_THROUGH = { handled: false, accepted: false, error: null }

function transport(): NativeChatStructuredComposerTransport {
  return {
    capturePresentation: () => () => true,
    send: vi.fn(() => true),
    dispatchCommand: vi.fn(async () => PASS_THROUGH),
    optionsSurface: {
      getSnapshot: () => [],
      setOption: vi.fn(),
      invokeAction: vi.fn(),
      subscribe: () => () => {}
    },
    optionSnapshot: [],
    onError: vi.fn(),
    runtime: 'remote',
    sessionId: 'session-test',
    runtimeEnvironmentId: null
  }
}

function Chat({
  structured,
  draftScopeKey
}: {
  structured: NativeChatStructuredComposerTransport
  draftScopeKey: string
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<NativeChatComposerHandle>(null)
  return (
    <div ref={rootRef}>
      <div data-native-chat-scroll="">
        <div {...NATIVE_CHAT_QUOTE_SOURCE_PROPS}>
          <p data-testid="reply">Ship it?</p>
        </div>
      </div>
      <NativeChatComposer
        ref={composerRef}
        terminalTabId="tab-quick"
        paneKey="tab-quick:structured"
        draftScopeKey={draftScopeKey}
        targetPtyId={null}
        agent="codex"
        structuredTransport={structured}
      />
      <NativeChatSelectionQuote rootRef={rootRef} composerRef={composerRef} enabled quickReplies />
    </div>
  )
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      git: { discoverCommitMessageModels: vi.fn().mockResolvedValue({ success: false }) },
      pty: { getMainBufferSnapshot: vi.fn().mockResolvedValue(null) },
      ui: { writeClipboardText: vi.fn().mockResolvedValue(undefined) }
    }
  })
})

afterEach(() => cleanup())

// Send reads the draft the composer last rendered, so the quote must render before the reply is sent.
it('sends the selection quoted below the draft, with yes under it, as Enter would', async () => {
  const structured = transport()
  const draftScopeKey = 'tab-quick:structured'
  writeNativeChatDraftCache(draftScopeKey, 'a draft reply')
  render(<Chat structured={structured} draftScopeKey={draftScopeKey} />, {
    wrapper: TooltipProvider
  })
  const reply = screen.getByTestId('reply')
  fireEvent.pointerDown(reply, { button: 0 })
  const range = document.createRange()
  range.selectNodeContents(reply)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  fireEvent.mouseUp(reply, { button: 0 })
  const yes = await screen.findByLabelText('Reply yes')
  await act(async () => {
    fireEvent.click(yes)
  })
  expect(structured.send).toHaveBeenCalledWith('a draft reply\n\n> Ship it?\n\nyes', [])
})
