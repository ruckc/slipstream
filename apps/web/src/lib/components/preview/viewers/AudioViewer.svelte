<script lang="ts">
  let { content, filename = '' }: { content: Uint8Array; filename?: string } = $props()

  let objectUrl = $state('')

  $effect(() => {
    const blob = new Blob([content])
    const url = URL.createObjectURL(blob)
    objectUrl = url
    return () => URL.revokeObjectURL(url)
  })

  let displayName = $derived(filename.split('/').pop() ?? 'Audio File')
</script>

<div class="audio-viewer">
  <div class="audio-icon" aria-hidden="true">
    <svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor">
      <path d="M9 3a1 1 0 0 0-1.707-.707L5.586 4H3.5A1.5 1.5 0 0 0 2 5.5v5A1.5 1.5 0 0 0 3.5 12h2.086l1.707 1.707A1 1 0 0 0 9 13V3zM8 4.414v7.172L6.707 10.293A1 1 0 0 0 6 10H3.5a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5H6a1 1 0 0 0 .707-.293L8 2.414zM11.5 7.5a.5.5 0 0 0 0 1H12a.5.5 0 0 0 0-1h-.5zm0-2a.5.5 0 0 0 0 1 2.5 2.5 0 0 1 0 5 .5.5 0 0 0 0 1 3.5 3.5 0 0 0 0-7z"/>
    </svg>
  </div>
  <p class="audio-name">{displayName}</p>
  {#if objectUrl}
    <audio
      src={objectUrl}
      controls
      class="audio-element"
      aria-label="Audio: {displayName}"
    >
      Your browser does not support the audio element.
    </audio>
  {/if}
</div>

<style>
  .audio-viewer {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--space-4);
    background: var(--color-bg-base);
    padding: var(--space-8);
  }

  .audio-icon {
    color: var(--color-text-muted);
    opacity: 0.5;
  }

  .audio-name {
    font-size: var(--font-size-md);
    color: var(--color-text-primary);
    text-align: center;
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .audio-element {
    width: 100%;
    max-width: 480px;
    accent-color: var(--color-accent);
  }
</style>
