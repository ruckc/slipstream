<script lang="ts">
  let {
    onSend,
    height = $bindable(0),
  }: {
    onSend: (data: string) => void
    height?: number
  } = $props()

  let shiftActive = $state(false)
  let shiftLocked = $state(false) // double-tap caps lock
  let ctrlActive = $state(false)
  let altActive = $state(false)
  let lastShiftTap = 0

  const BS = '\x7f'
  const ESC = '\x1b'
  const TAB = '\t'
  const ENTER = '\r'
  const SPACE = ' '
  const ARROW_UP = '\x1b[A'
  const ARROW_DOWN = '\x1b[B'
  const ARROW_LEFT = '\x1b[D'
  const ARROW_RIGHT = '\x1b[C'
  const HOME = '\x1b[H'
  const END = '\x1b[F'
  const PAGE_UP = '\x1b[5~'
  const PAGE_DOWN = '\x1b[6~'
  const DEL_FWD = '\x1b[3~'

  const SHIFT_NUMS: Record<string, string> = {
    '1': '!',
    '2': '@',
    '3': '#',
    '4': '$',
    '5': '%',
    '6': '^',
    '7': '&',
    '8': '*',
    '9': '(',
    '0': ')',
  }

  // Ctrl+A=\x01 … Ctrl+Z=\x1a
  function ctrlSeq(ch: string): string {
    return String.fromCharCode(ch.toUpperCase().charCodeAt(0) - 64)
  }

  function sendKey(raw: string) {
    let ch = raw
    if (ctrlActive && /^[a-zA-Z]$/.test(ch)) {
      onSend(ctrlSeq(ch))
      ctrlActive = false
      return
    }
    if (shiftActive || shiftLocked) {
      if (/^[a-z]$/.test(ch)) ch = ch.toUpperCase()
      else if (SHIFT_NUMS[ch]) ch = SHIFT_NUMS[ch]
    }
    if (altActive) {
      onSend(ESC + ch)
      altActive = false
    } else {
      onSend(ch)
    }
    // auto-release shift (not caps lock)
    if (shiftActive && !shiftLocked) shiftActive = false
  }

  function tapShift(e: Event) {
    e.preventDefault()
    const now = Date.now()
    if (now - lastShiftTap < 400) {
      // double-tap → caps lock
      shiftLocked = !shiftLocked
      shiftActive = shiftLocked
    } else {
      shiftLocked = false
      shiftActive = !shiftActive
    }
    lastShiftTap = now
  }

  function tap(e: Event, data: string) {
    e.preventDefault()
    onSend(data)
    if (altActive && data !== ESC) altActive = false
  }

  function tapKey(e: Event, raw: string) {
    e.preventDefault()
    sendKey(raw)
  }

  function tapCtrl(e: Event) {
    e.preventDefault()
    ctrlActive = !ctrlActive
    altActive = false
  }

  function tapAlt(e: Event) {
    e.preventDefault()
    altActive = !altActive
    ctrlActive = false
  }

  const row1 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
  const row2 = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p']
  const row3 = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l']
  const row4 = ['z', 'x', 'c', 'v', 'b', 'n', 'm']

  function displayChar(ch: string): string {
    if (ctrlActive && /^[a-zA-Z]$/.test(ch)) return '^' + ch.toUpperCase()
    if (shiftActive || shiftLocked) {
      if (/^[a-z]$/.test(ch)) return ch.toUpperCase()
      if (SHIFT_NUMS[ch]) return SHIFT_NUMS[ch]
    }
    return ch
  }

  const specialRow = [
    { label: '~', data: '~' },
    { label: '/', data: '/' },
    { label: '-', data: '-' },
    { label: '_', data: '_' },
    { label: '|', data: '|' },
    { label: '\\', data: '\\' },
    { label: '`', data: '`' },
    { label: "'", data: "'" },
    { label: '"', data: '"' },
    { label: ';', data: ';' },
    { label: ':', data: ':' },
    { label: '(', data: '(' },
    { label: ')', data: ')' },
    { label: '[', data: '[' },
    { label: ']', data: ']' },
    { label: '{', data: '{' },
    { label: '}', data: '}' },
    { label: '<', data: '<' },
    { label: '>', data: '>' },
    { label: '=', data: '=' },
    { label: '+', data: '+' },
    { label: '?', data: '?' },
    { label: '!', data: '!' },
    { label: '@', data: '@' },
    { label: '#', data: '#' },
    { label: '$', data: '$' },
    { label: '%', data: '%' },
    { label: '&', data: '&' },
    { label: '*', data: '*' },
    { label: 'Del→', data: DEL_FWD },
    { label: 'Home', data: HOME },
    { label: 'End', data: END },
    { label: 'PgUp', data: PAGE_UP },
    { label: 'PgDn', data: PAGE_DOWN },
  ]
</script>

<div class="mkb" role="toolbar" aria-label="Terminal keyboard" bind:clientHeight={height}>
  <!-- Function row: arrows + scrollable specials -->
  <div class="mkb-row mkb-row--fn">
    <button class="mkb-key" onpointerdown={(e) => tap(e, ESC)}>Esc</button>
    <button class="mkb-key" onpointerdown={(e) => tap(e, TAB)}>Tab</button>
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

  <!-- Scrollable special chars row -->
  <div class="mkb-row mkb-row--scroll">
    {#each specialRow as k (k.label)}
      <button class="mkb-key mkb-key--special" onpointerdown={(e) => tap(e, k.data)}
        >{k.label}</button
      >
    {/each}
  </div>

  <!-- Number row -->
  <div class="mkb-row mkb-row--stretch">
    {#each row1 as ch (ch)}
      <button class="mkb-key mkb-key--char" onpointerdown={(e) => tapKey(e, ch)}
        >{displayChar(ch)}</button
      >
    {/each}
  </div>

  <!-- QWERTY -->
  <div class="mkb-row mkb-row--stretch">
    {#each row2 as ch (ch)}
      <button
        class="mkb-key mkb-key--char"
        class:mkb-key--ctrl-hint={ctrlActive}
        onpointerdown={(e) => tapKey(e, ch)}>{displayChar(ch)}</button
      >
    {/each}
  </div>

  <!-- ASDF -->
  <div class="mkb-row mkb-row--stretch mkb-row--indent">
    {#each row3 as ch (ch)}
      <button
        class="mkb-key mkb-key--char"
        class:mkb-key--ctrl-hint={ctrlActive}
        onpointerdown={(e) => tapKey(e, ch)}>{displayChar(ch)}</button
      >
    {/each}
  </div>

  <!-- Shift + ZXCV + Backspace -->
  <div class="mkb-row mkb-row--stretch">
    <button
      class="mkb-key mkb-key--action"
      class:mkb-key--active={shiftActive || shiftLocked}
      class:mkb-key--locked={shiftLocked}
      onpointerdown={tapShift}
      title="Shift (double-tap for caps lock)">⇧</button
    >
    {#each row4 as ch (ch)}
      <button
        class="mkb-key mkb-key--char"
        class:mkb-key--ctrl-hint={ctrlActive}
        onpointerdown={(e) => tapKey(e, ch)}>{displayChar(ch)}</button
      >
    {/each}
    <button class="mkb-key mkb-key--action" onpointerdown={(e) => tap(e, BS)} title="Backspace"
      >⌫</button
    >
  </div>

  <!-- Bottom row: Ctrl Alt Space Enter -->
  <div class="mkb-row mkb-row--bottom">
    <button
      class="mkb-key mkb-key--mod mkb-key--sm"
      class:mkb-key--active={ctrlActive}
      onpointerdown={tapCtrl}>Ctrl</button
    >
    <button
      class="mkb-key mkb-key--mod mkb-key--sm"
      class:mkb-key--active={altActive}
      onpointerdown={tapAlt}>Alt</button
    >
    <button class="mkb-key mkb-key--space" onpointerdown={(e) => tap(e, SPACE)}>space</button>
    <button class="mkb-key mkb-key--action mkb-key--enter" onpointerdown={(e) => tap(e, ENTER)}
      >↵</button
    >
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
    gap: 3px;
    background: #131313;
    border-top: 1px solid #3a3a3a;
    padding: 4px 3px;
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

  .mkb-row--fn {
    gap: 3px;
  }

  .mkb-row--scroll {
    overflow-x: auto;
    scrollbar-width: none;
    flex-wrap: nowrap;
  }
  .mkb-row--scroll::-webkit-scrollbar {
    display: none;
  }

  .mkb-row--stretch {
    justify-content: stretch;
  }
  .mkb-row--stretch .mkb-key--char {
    flex: 1;
    min-width: 0;
    padding: 0;
  }

  .mkb-row--indent {
    padding: 0 5%;
  }

  .mkb-row--bottom {
    gap: 3px;
  }

  /* Base key */
  .mkb-key {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 38px;
    min-width: 28px;
    padding: 0 5px;
    background: #2c2c2c;
    border: 1px solid #3a3a3a;
    border-radius: 5px;
    color: #ddd;
    font-size: 14px;
    font-family: var(--font-sans, system-ui, sans-serif);
    white-space: nowrap;
    flex-shrink: 0;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition: background 60ms;
  }

  .mkb-key:active {
    background: #555;
    border-color: #666;
    color: #fff;
  }

  .mkb-key--mod {
    background: #1e1e1e;
    border-color: #3a3a3a;
    color: #aaa;
    font-size: 11px;
    font-weight: 700;
    min-width: 42px;
    letter-spacing: 0.02em;
  }

  .mkb-key--sm {
    min-width: 36px;
    font-size: 10px;
  }

  .mkb-key--action {
    background: #1e1e1e;
    border-color: #3a3a3a;
    color: #bbb;
    min-width: 44px;
    font-size: 16px;
  }

  .mkb-key--enter {
    min-width: 52px;
    color: #6af;
    font-size: 18px;
  }

  .mkb-key--active {
    background: #005f87 !important;
    border-color: #0087af !important;
    color: #fff !important;
  }

  .mkb-key--locked {
    background: #006f4f !important;
    border-color: #00af7f !important;
  }

  .mkb-key--arrow {
    font-size: 16px;
    min-width: 36px;
  }

  .mkb-key--special {
    background: #222;
    border-color: #3a3a3a;
    color: #bbb;
    font-size: 12px;
    font-family: var(--font-mono, monospace);
    min-width: 34px;
    height: 32px;
  }

  .mkb-key--char {
    font-size: 16px;
    font-weight: 500;
    height: 40px;
  }

  .mkb-key--ctrl-hint {
    color: #f9a825;
  }

  .mkb-key--space {
    flex: 1;
    font-size: 12px;
    color: #888;
    background: #2c2c2c;
  }

  @media (min-width: 640px) {
    .mkb {
      display: none;
    }
  }
</style>
