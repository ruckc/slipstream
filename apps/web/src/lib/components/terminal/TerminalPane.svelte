<script lang="ts">
  import { onMount, getContext } from 'svelte'
  import { podWsUrl } from '$lib/pod-fetch'
  import { tokenStore } from '$lib/token-store'
  import { WORKSPACE_CTX } from '$lib/components/workspace/WorkspaceTypes.js'
  import type { WorkspaceCtx } from '$lib/components/workspace/WorkspaceTypes.js'
  import MobileTerminalKeyboard from './MobileTerminalKeyboard.svelte'

  let {
    paneId,
    sessionId,
    projectId,
    namespaceSlug,
    projectSlug,
    onRename,
    onCwdChange,
  }: {
    paneId?: string
    sessionId: string
    sessionLabel?: string
    projectId: string
    namespaceSlug: string
    projectSlug: string
    onRename?: (newLabel: string) => void
    onCwdChange?: (path: string) => void
  } = $props()

  const ctx = getContext<WorkspaceCtx | undefined>(WORKSPACE_CTX)

  let terminalEl = $state<HTMLDivElement | undefined>(undefined)
  let statusMessage = $state<string | null>(null)
  let reconnectAttempt = $state(0)
  let mobileKeyboardVisible = $state(false)
  let mobileKeyboardHeight = $state(0)
  let mobileSelectMode = $state(false)
  let xtermTextarea = $state<HTMLTextAreaElement | undefined>(undefined)
  // Keys typed while WS is not OPEN are queued and flushed on reconnect
  let inputQueue: string[] = []

  $effect(() => {
    if (mobileKeyboardHeight >= 0) requestAnimationFrame(() => fitAddon?.fit())
  })

  const ARROW_SEQS: Record<string, [string, string]> = {
    ArrowUp: ['\x1b[A', '\x1bOA'],
    ArrowDown: ['\x1b[B', '\x1bOB'],
    ArrowLeft: ['\x1b[D', '\x1bOD'],
    ArrowRight: ['\x1b[C', '\x1bOC'],
  }

  function dispatchKey(init: KeyboardEventInit) {
    const key = init.key ?? ''
    const arrowSeq = ARROW_SEQS[key]
    if (arrowSeq) {
      const app = terminal?.modes.applicationCursorKeysMode ?? false
      sendInput(app ? arrowSeq[1] : arrowSeq[0])
      return
    }
    xtermTextarea?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    )
  }

  // State managed outside Svelte reactivity to avoid re-render overhead
  let terminal: import('@xterm/xterm').Terminal | null = null
  let fitAddon: import('@xterm/addon-fit').FitAddon | null = null
  let ws: WebSocket | null = null
  let lastSeq = 0
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  const XTERM_THEME = {
    background: '#1e1e1e',
    foreground: '#cccccc',
    cursor: '#cccccc',
    cursorAccent: '#1e1e1e',
    selectionBackground: '#264f78',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#e5e5e5',
  }

  async function initTerminal() {
    if (!terminalEl || destroyed) return

    const { Terminal } = await import('@xterm/xterm')
    const { FitAddon } = await import('@xterm/addon-fit')
    const { WebLinksAddon } = await import('@xterm/addon-web-links')

    terminal = new Terminal({
      theme: XTERM_THEME,
      fontFamily:
        "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowTransparency: false,
      macOptionIsMeta: true,
      allowProposedApi: true,
    })

    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    // Only open links to public internet URLs. Private/local addresses (localhost,
    // 192.168.x, 10.x, etc.) would trigger Chrome's Private Network Access dialog
    // on mobile when a public origin (slips.ruck.io) tries to navigate to them.
    terminal.loadAddon(
      new WebLinksAddon((_event, url) => {
        try {
          const { hostname } = new URL(url)
          const priv =
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '::1' ||
            hostname.endsWith('.local') ||
            /^10\./.test(hostname) ||
            /^192\.168\./.test(hostname) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
          if (!priv) window.open(url, '_blank', 'noopener,noreferrer')
        } catch {
          // malformed URL — ignore
        }
      })
    )

    terminal.open(terminalEl)
    fitAddon.fit()

    // Suppress the OS soft keyboard on mobile by setting inputmode="none"
    // on xterm's hidden textarea, then show our custom keyboard instead.
    xtermTextarea =
      terminalEl.querySelector<HTMLTextAreaElement>('textarea.xterm-helper-textarea') ?? undefined
    if (xtermTextarea) {
      xtermTextarea.setAttribute('inputmode', 'none')
      xtermTextarea.addEventListener('focus', () => {
        // Only show custom keyboard on narrow/touch screens
        if (!mobileSelectMode && window.matchMedia('(max-width: 639px)').matches) {
          mobileKeyboardVisible = true
        }
      })
      // Do NOT hide on blur — key presses would steal focus briefly on iOS,
      // causing the keyboard to flash away and drop the visual input sequence.
      // The keyboard is dismissed via its explicit close button instead.
    }

    terminal.onTitleChange((title) => {
      if (title) onRename?.(title)
    })

    // OSC 7 — shell reports CWD after each prompt (file://hostname/path)
    terminal.parser.registerOscHandler(7, (data) => {
      try {
        const url = new URL(data)
        onCwdChange?.(decodeURIComponent(url.pathname))
      } catch {
        if (data.startsWith('/')) onCwdChange?.(data)
      }
      return true
    })

    terminal.onData((data) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(
        JSON.stringify({
          type: 'input',
          data: btoa(unescape(encodeURIComponent(data))),
        })
      )
    })

    terminal.onResize(({ cols, rows }) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    })

    // Handle container resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon) fitAddon.fit()
    })
    if (terminalEl) resizeObserver.observe(terminalEl)

    await connectWs()
  }

  async function connectWs() {
    if (destroyed) return

    try {
      statusMessage = reconnectAttempt > 0 ? `Reconnecting… (attempt ${reconnectAttempt})` : null
      const token = await tokenStore.get(projectId)
      const url = podWsUrl(namespaceSlug, projectSlug, `/sessions/${sessionId}/attach`, token)

      if (destroyed) return

      ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        if (!ws) return
        statusMessage = null
        reconnectAttempt = 0
        // Request replay from last seen sequence
        if (lastSeq > 0) {
          ws.send(JSON.stringify({ type: 'replay_from', seq: lastSeq }))
        }
        // Send current terminal dimensions
        if (terminal && fitAddon) {
          fitAddon.fit()
          ws.send(
            JSON.stringify({
              type: 'resize',
              cols: terminal.cols,
              rows: terminal.rows,
            })
          )
        }
        // Flush any keys typed while the connection was being established
        if (inputQueue.length > 0) {
          for (const data of inputQueue) {
            ws.send(
              JSON.stringify({ type: 'input', data: btoa(unescape(encodeURIComponent(data))) })
            )
          }
          inputQueue = []
        }
      }

      ws.onmessage = (event) => {
        if (!terminal) return
        try {
          const msg = JSON.parse(
            typeof event.data === 'string'
              ? event.data
              : new TextDecoder().decode(event.data as ArrayBuffer)
          ) as { type: string; seq?: number; data?: string; code?: number }

          if (msg.type === 'output' && msg.data) {
            // data is base64-encoded bytes
            const decoded = decodeURIComponent(escape(atob(msg.data)))
            terminal.write(decoded)
            if (msg.seq !== undefined) lastSeq = msg.seq
          } else if (msg.type === 'exit') {
            terminal.write(
              '\r\n\x1b[90m[Process exited with code ' + (msg.code ?? 0) + ']\x1b[0m\r\n'
            )
          } else if (msg.type === 'error') {
            terminal.write('\r\n\x1b[31m[Error: ' + (msg.data ?? 'Unknown error') + ']\x1b[0m\r\n')
          }
        } catch {
          // Binary data or parse error — write raw if it's a string
          if (typeof event.data === 'string') {
            terminal.write(event.data)
          }
        }
      }

      ws.onclose = (event) => {
        if (destroyed) return
        if (!event.wasClean && event.code !== 1000) {
          scheduleReconnect()
        }
      }

      ws.onerror = () => {
        if (destroyed) return
        scheduleReconnect()
      }
    } catch {
      if (!destroyed) scheduleReconnect()
    }
  }

  function scheduleReconnect() {
    if (destroyed) return
    if (reconnectTimeout) clearTimeout(reconnectTimeout)
    reconnectAttempt++
    const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempt - 1), 30_000)
    statusMessage = `Reconnecting in ${Math.round(delay / 1000)}s…`
    reconnectTimeout = setTimeout(() => {
      if (!destroyed) connectWs()
    }, delay)
  }

  function sendInput(data: string) {
    terminal?.scrollToBottom()
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Queue rather than silently drop — flushed once WS is open again
      inputQueue.push(data)
      return
    }
    ws.send(JSON.stringify({ type: 'input', data: btoa(unescape(encodeURIComponent(data))) }))
  }

  function clearTerminal() {
    if (terminal) terminal.clear()
  }

  function killSession() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'kill' }))
    }
  }

  function hideKeyboard() {
    mobileKeyboardVisible = false
    xtermTextarea?.blur()
  }

  function toggleSelectMode() {
    mobileSelectMode = !mobileSelectMode
    if (mobileSelectMode) {
      // Hide keyboard so touch gestures reach xterm for selection
      mobileKeyboardVisible = false
      xtermTextarea?.blur()
    } else {
      // Return to input mode
      mobileKeyboardVisible = true
    }
  }

  async function copySelection() {
    const text = terminal?.getSelection()
    if (text) {
      await navigator.clipboard.writeText(text).catch(() => {})
      terminal?.clearSelection()
    }
    mobileSelectMode = false
    mobileKeyboardVisible = true
  }

  onMount(() => {
    if (ctx && paneId) {
      ctx.registerTerminalActions(paneId, { clear: clearTerminal, kill: killSession })
    }
    initTerminal()
    return () => {
      if (ctx && paneId) ctx.unregisterTerminalActions(paneId)
      destroyed = true
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      if (ws) {
        ws.onclose = null
        ws.onerror = null
        ws.close(1000, 'Component destroyed')
      }
      if (terminal) terminal.dispose()
    }
  })
</script>

<div class="terminal-pane" id="terminal-pane-{sessionId}">
  <div class="terminal-container">
    <div class="xterm-host" bind:this={terminalEl}></div>
    {#if statusMessage}
      <div class="terminal-status" aria-live="polite">{statusMessage}</div>
    {/if}
  </div>
  {#if mobileSelectMode}
    <div class="select-bar">
      <span class="select-bar__hint">Drag to select text</span>
      <button
        class="select-bar__btn select-bar__btn--copy"
        onpointerdown={(e) => {
          e.preventDefault()
          copySelection()
        }}>Copy</button
      >
      <button
        class="select-bar__btn"
        onpointerdown={(e) => {
          e.preventDefault()
          toggleSelectMode()
        }}>Cancel</button
      >
    </div>
  {/if}
  {#if mobileKeyboardVisible && !mobileSelectMode}
    <!-- Spacer pushes the terminal content up so it isn't hidden behind the
         absolutely-positioned keyboard anchored to the pane bottom. -->
    <div style:height="{mobileKeyboardHeight}px" style:flex-shrink="0"></div>
    <MobileTerminalKeyboard
      onSend={sendInput}
      onKey={dispatchKey}
      onToggleSelect={toggleSelectMode}
      onClose={hideKeyboard}
      bind:height={mobileKeyboardHeight}
    />
  {/if}
</div>

<style>
  .terminal-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: #1e1e1e;
    overflow: hidden;
    position: relative;
  }

  .terminal-container {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }

  .xterm-host {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  /* xterm.js global styles */
  .xterm-host :global(.xterm) {
    height: 100%;
    background: #1e1e1e; /* fill gap below last row before xterm sets it inline */
  }

  .xterm-host :global(.xterm-viewport) {
    overflow-y: auto;
    background: #1e1e1e !important; /* prevent transparent strip below rows */
  }

  .select-bar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    padding-bottom: max(var(--space-2), env(safe-area-inset-bottom));
    background: #1a1a2e;
    border-top: 1px solid #3a3a5c;
  }

  .select-bar__hint {
    flex: 1;
    font-size: var(--font-size-xs);
    color: #8888cc;
  }

  .select-bar__btn {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid #3a3a5c;
    background: #2a2a4e;
    color: #aaaaee;
    font-size: var(--font-size-xs);
    font-weight: 500;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .select-bar__btn--copy {
    background: #005f87;
    border-color: #0087af;
    color: #fff;
  }

  .terminal-status {
    position: absolute;
    bottom: var(--space-3);
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.85);
    color: var(--color-warning);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    pointer-events: none;
    white-space: nowrap;
    z-index: 10;
  }
</style>
