<script lang="ts">
  let { content }: { content: Uint8Array } = $props()

  let objectUrl = $state('')
  let scale = $state(1)
  let translateX = $state(0)
  let translateY = $state(0)
  let dragging = $state(false)
  let lastPointerX = $state(0)
  let lastPointerY = $state(0)
  let imageEl = $state<HTMLImageElement | undefined>(undefined)
  let naturalWidth = $state(0)
  let naturalHeight = $state(0)

  $effect(() => {
    const blob = new Blob([content.slice()])
    const url = URL.createObjectURL(blob)
    objectUrl = url
    // Reset pan/zoom when content changes
    scale = 1
    translateX = 0
    translateY = 0
    return () => URL.revokeObjectURL(url)
  })

  function handleWheel(e: WheelEvent) {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    scale = Math.max(0.1, Math.min(10, scale * factor))
  }

  function handlePointerDown(e: PointerEvent) {
    dragging = true
    lastPointerX = e.clientX
    lastPointerY = e.clientY
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragging) return
    translateX += e.clientX - lastPointerX
    translateY += e.clientY - lastPointerY
    lastPointerX = e.clientX
    lastPointerY = e.clientY
  }

  function handlePointerUp() {
    dragging = false
  }

  function handleImageLoad() {
    if (imageEl) {
      naturalWidth = imageEl.naturalWidth
      naturalHeight = imageEl.naturalHeight
    }
  }

  function resetView() {
    scale = 1
    translateX = 0
    translateY = 0
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="image-viewer"
  class:image-viewer--dragging={dragging}
  onwheel={handleWheel}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
>
  {#if objectUrl}
    <img
      src={objectUrl}
      alt="Preview"
      class="image-content"
      style="transform: translate({translateX}px, {translateY}px) scale({scale});"
      bind:this={imageEl}
      onload={handleImageLoad}
      draggable="false"
    />
  {/if}
  <div class="image-controls">
    <button
      class="image-ctrl-btn"
      onclick={() => {
        scale = Math.min(10, scale * 1.2)
      }}
      aria-label="Zoom in">+</button
    >
    <button class="image-ctrl-btn" onclick={resetView} aria-label="Reset view">1:1</button>
    <button
      class="image-ctrl-btn"
      onclick={() => {
        scale = Math.max(0.1, scale / 1.2)
      }}
      aria-label="Zoom out">-</button
    >
    {#if naturalWidth > 0}
      <span class="image-info"
        >{naturalWidth} x {naturalHeight} &bull; {Math.round(scale * 100)}%</span
      >
    {/if}
  </div>
</div>

<style>
  .image-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-bg-base);
    overflow: hidden;
    position: relative;
    cursor: grab;
    user-select: none;
    touch-action: none;
  }

  .image-viewer--dragging {
    cursor: grabbing;
  }

  .image-content {
    position: absolute;
    top: 50%;
    left: 50%;
    max-width: none;
    transform-origin: center center;
    will-change: transform;
    /* margin: -50% not needed because we offset via JS */
    image-rendering: pixelated;
  }

  .image-controls {
    position: absolute;
    bottom: var(--space-3);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-1) var(--space-2);
    z-index: 1;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .image-ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 22px;
    padding: 0 var(--space-1);
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--color-text-primary);
    border-radius: var(--radius-sm);
    transition: background var(--transition-fast);
    cursor: pointer;
  }

  .image-ctrl-btn:hover {
    background: var(--color-bg-hover);
  }

  .image-info {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    padding-left: var(--space-1);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
</style>
