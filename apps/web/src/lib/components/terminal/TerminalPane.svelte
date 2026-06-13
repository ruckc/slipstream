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
  }: {
    paneId?: string
    sessionId: string
    sessionLabel?: string
    projectId: string
    namespaceSlug: string
    projectSlug: string
    onRename?: (newLabel: string) => void
  } = $props()

  const ctx = getContext<WorkspaceCtx | undefined>(WORKSPACE_CTX)

  let terminalEl = $state<HTMLDivElement | undefined>(undefined)
  let statusMessage = $state<string | null>(null)
  let reconnectAttempt = $state(0)
  let mobileKeyboardVisible = $state(false)
  let mobileKeyboardHeight = $state(0)

  $effect(() => {
    if (mobileKeyboardHeight >= 0) requestAnimationFrame(() => fitAddon?.fit())
  })

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
    })

    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())

    terminal.open(terminalEl)
    fitAddon.fit()

    // Suppress the OS soft keyboard on mobile by setting inputmode="none"
    // on xterm's hidden textarea, then show our custom keyboard instead.
    const xtermTextarea = terminalEl.querySelector<HTMLTextAreaElement>(
      'textarea.xterm-helper-textarea'
    )
    if (xtermTextarea) {
      xtermTextarea.setAttribute('inputmode', 'none')
      xtermTextarea.addEventListener('focus', () => {
        mobileKeyboardVisible = true
      })
      xtermTextarea.addEventListener('blur', () => {
        mobileKeyboardVisible = false
      })
    }

    terminal.onTitleChange((title) => {
      if (title) onRename?.(title)
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
    if (!ws || ws.readyState !== WebSocket.OPEN) return
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
  {#if mobileKeyboardVisible && mobileKeyboardHeight > 0}
    <div style="height: {mobileKeyboardHeight}px; flex-shrink: 0;"></div>
  {/if}
</div>
{#if mobileKeyboardVisible}
  <MobileTerminalKeyboard onSend={sendInput} bind:height={mobileKeyboardHeight} />
{/if}

<style>
  .terminal-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: #1e1e1e;
    overflow: hidden;
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
