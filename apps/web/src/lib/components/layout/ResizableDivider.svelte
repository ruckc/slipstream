<script lang="ts">
  let {
    direction = 'horizontal',
    size = $bindable(200),
    minSize = 100,
    maxSize = 800,
    inverted = false,
  }: {
    direction?: 'horizontal' | 'vertical'
    size?: number
    minSize?: number
    maxSize?: number
    inverted?: boolean
  } = $props()

  let dragging = $state(false)
  let startPos = 0
  let startSize = 0

  function onPointerDown(e: PointerEvent) {
    e.preventDefault()
    dragging = true
    startPos = direction === 'horizontal' ? e.clientX : e.clientY
    startSize = size
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return
    const currentPos = direction === 'horizontal' ? e.clientX : e.clientY
    const delta = currentPos - startPos
    const newSize = inverted ? startSize - delta : startSize + delta
    size = Math.max(minSize, Math.min(maxSize, newSize))
  }

  function onPointerUp() {
    dragging = false
  }
</script>

<div
  class="divider divider--{direction}"
  class:divider--dragging={dragging}
  role="separator"
  aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
></div>

<style>
  .divider {
    flex-shrink: 0;
    background: var(--color-border-subtle);
    transition: background var(--transition-fast);
    position: relative;
    z-index: 10;
  }

  .divider--horizontal {
    width: 4px;
    cursor: col-resize;
    height: 100%;
  }

  .divider--vertical {
    height: 4px;
    cursor: row-resize;
    width: 100%;
  }

  .divider:hover,
  .divider--dragging {
    background: var(--color-accent);
  }

  /* Larger invisible hit area */
  .divider::before {
    content: '';
    position: absolute;
    inset: 0;
  }

  .divider--horizontal::before {
    left: -3px;
    right: -3px;
  }

  .divider--vertical::before {
    top: -3px;
    bottom: -3px;
  }
</style>
