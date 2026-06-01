<script lang="ts">
  let { content }: { content: Uint8Array } = $props()

  let objectUrl = $state('')

  $effect(() => {
    const blob = new Blob([content])
    const url = URL.createObjectURL(blob)
    objectUrl = url
    return () => URL.revokeObjectURL(url)
  })
</script>

<div class="video-viewer">
  {#if objectUrl}
    <video
      src={objectUrl}
      controls
      class="video-element"
      aria-label="Video file"
    >
      Your browser does not support the video element.
    </video>
  {/if}
</div>

<style>
  .video-viewer {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    background: #000;
    overflow: hidden;
  }

  .video-element {
    max-width: 100%;
    max-height: 100%;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
