<script lang="ts">
  let {
    onSend,
    height = $bindable(0),
  }: {
    onSend: (data: string) => void
    height?: number
  } = $props()

  let ctrlActive = $state(false)
  let altActive = $state(false)

  // Key sequences
  const ESC = '\x1b'
  const TAB = '\t'
  const ARROW_UP = '\x1b[A'
  const ARROW_DOWN = '\x1b[B'
  const ARROW_LEFT = '\x1b[D'
  const ARROW_RIGHT = '\x1b[C'
  const HOME = '\x1b[H'
  const END = '\x1b[F'
  const PAGE_UP = '\x1b[5~'
  const PAGE_DOWN = '\x1b[6~'
  const DEL = '\x1b[3~'

  // Ctrl+letter = byte offset from 0x60
  const CTRL: Record<string, string> = {
    C: '\x03',
    D: '\x04',
    Z: '\x1a',
    L: '\x0c',
    A: '\x01',
    E: '\x05',
    W: '\x17',
    U: '\x15',
    R: '\x12',
    K: '\x0b',
    B: '\x02',
    F: '\x06',
  }

  function send(data: string) {
    let out = data
    if (altActive && !ctrlActive) {
      out = ESC + data
    }
    onSend(out)
    // Auto-release modifier after use (except for ctrl which users often hold)
    if (altActive) altActive = false
  }

  function sendCtrl(letter: string) {
    const seq = CTRL[letter]
    if (seq) onSend(seq)
    ctrlActive = false
  }

  function tap(e: Event, data: string) {
    e.preventDefault()
    send(data)
  }

  function tapCtrl(e: Event, letter: string) {
    e.preventDefault()
    sendCtrl(letter)
  }

  // Rows shown when no modifier or alt active
  const charRow = [
    { label: '~', data: '~' },
    { label: '/', data: '/' },
    { label: '-', data: '-' },
    { label: '_', data: '_' },
    { label: '|', data: '|' },
    { label: '\\', data: '\\' },
    { label: '`', data: '`' },
    { label: 'Del', data: DEL },
    { label: 'Home', data: HOME },
    { label: 'End', data: END },
    { label: 'PgUp', data: PAGE_UP },
    { label: 'PgDn', data: PAGE_DOWN },
  ]

  // Ctrl shortcuts
  const ctrlRow = [
    { label: 'C', letter: 'C', title: 'Ctrl+C (interrupt)' },
    { label: 'D', letter: 'D', title: 'Ctrl+D (EOF)' },
    { label: 'Z', letter: 'Z', title: 'Ctrl+Z (suspend)' },
    { label: 'L', letter: 'L', title: 'Ctrl+L (clear)' },
    { label: 'A', letter: 'A', title: 'Ctrl+A (line start)' },
    { label: 'E', letter: 'E', title: 'Ctrl+E (line end)' },
    { label: 'W', letter: 'W', title: 'Ctrl+W (del word)' },
    { label: 'U', letter: 'U', title: 'Ctrl+U (del line)' },
    { label: 'R', letter: 'R', title: 'Ctrl+R (history)' },
    { label: 'K', letter: 'K', title: 'Ctrl+K (del to end)' },
    { label: 'B', letter: 'B', title: 'Ctrl+B (back)' },
    { label: 'F', letter: 'F', title: 'Ctrl+F (forward)' },
  ]
</script>

<div class="mkb" role="toolbar" aria-label="Terminal keyboard" bind:clientHeight={height}>
  <!-- Row 1: modifiers + navigation -->
  <div class="mkb-row">
    <button
      class="mkb-key mkb-key--mod"
      class:mkb-key--active={ctrlActive}
      onpointerdown={(e) => {
        e.preventDefault()
        ctrlActive = !ctrlActive
        altActive = false
      }}
      title="Ctrl modifier">Ctrl</button
    >
    <button
      class="mkb-key mkb-key--mod"
      class:mkb-key--active={altActive}
      onpointerdown={(e) => {
        e.preventDefault()
        altActive = !altActive
        ctrlActive = false
      }}
      title="Alt modifier">Alt</button
    >
    <button class="mkb-key" onpointerdown={(e) => tap(e, ESC)} title="Escape">Esc</button>
    <button class="mkb-key" onpointerdown={(e) => tap(e, TAB)} title="Tab">Tab</button>
    <div class="mkb-spacer"></div>
    <button class="mkb-key mkb-key--arrow" onpointerdown={(e) => tap(e, ARROW_UP)} aria-label="Up"
      >↑</button
    >
    <button
      class="mkb-key mkb-key--arrow"
      onpointerdown={(e) => tap(e, ARROW_DOWN)}
      aria-label="Down">↓</button
    >
    <button
      class="mkb-key mkb-key--arrow"
      onpointerdown={(e) => tap(e, ARROW_LEFT)}
      aria-label="Left">←</button
    >
    <button
      class="mkb-key mkb-key--arrow"
      onpointerdown={(e) => tap(e, ARROW_RIGHT)}
      aria-label="Right">→</button
    >
  </div>

  <!-- Row 2: context-sensitive keys -->
  <div class="mkb-row mkb-row--scroll">
    {#if ctrlActive}
      {#each ctrlRow as k (k.letter)}
        <button
          class="mkb-key mkb-key--ctrl"
          onpointerdown={(e) => tapCtrl(e, k.letter)}
          title={k.title}
        >
          ^{k.label}
        </button>
      {/each}
    {:else}
      {#each charRow as k (k.label)}
        <button class="mkb-key" onpointerdown={(e) => tap(e, k.data)}>{k.label}</button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .mkb {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: #1a1a1a;
    border-top: 1px solid #444;
    padding: 4px;
    padding-bottom: max(4px, env(safe-area-inset-bottom));
    user-select: none;
    -webkit-user-select: none;
  }

  .mkb-row {
    display: flex;
    flex-direction: row;
    gap: 3px;
    align-items: center;
  }

  .mkb-row--scroll {
    overflow-x: auto;
    scrollbar-width: none;
  }
  .mkb-row--scroll::-webkit-scrollbar {
    display: none;
  }

  .mkb-spacer {
    flex: 1;
  }

  .mkb-key {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 40px;
    height: 32px;
    padding: 0 6px;
    background: #2d2d2d;
    border: 1px solid #444;
    border-radius: 5px;
    color: #ccc;
    font-size: 12px;
    font-family: var(--font-mono, monospace);
    white-space: nowrap;
    flex-shrink: 0;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .mkb-key:active {
    background: #444;
    color: #fff;
  }

  .mkb-key--mod {
    background: #3a3a3a;
    color: #aaa;
    font-family: var(--font-sans, sans-serif);
    font-size: 11px;
    font-weight: 600;
  }

  .mkb-key--active {
    background: #005f87;
    border-color: #0087af;
    color: #fff;
  }

  .mkb-key--arrow {
    font-size: 16px;
    min-width: 36px;
  }

  .mkb-key--ctrl {
    color: #f9a825;
    font-size: 11px;
  }

  @media (min-width: 640px) {
    .mkb {
      display: none;
    }
  }
</style>
