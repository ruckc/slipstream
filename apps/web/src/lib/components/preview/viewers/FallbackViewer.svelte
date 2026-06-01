<script lang="ts">
  let { content, filename = '' }: { content: Uint8Array; filename?: string } = $props()

  // Show up to 512 bytes as hex dump
  const PREVIEW_BYTES = 512
  const BYTES_PER_ROW = 16

  interface HexRow {
    offset: number
    offsetHex: string
    hex: string[]
    ascii: string
  }

  let rows = $derived.by<HexRow[]>(() => {
    const preview = content.slice(0, PREVIEW_BYTES)
    const result: HexRow[] = []
    for (let i = 0; i < preview.length; i += BYTES_PER_ROW) {
      const chunk = preview.slice(i, i + BYTES_PER_ROW)
      const hex: string[] = []
      let ascii = ''
      for (let j = 0; j < chunk.length; j++) {
        const byte = chunk[j]
        hex.push(byte.toString(16).padStart(2, '0'))
        // Printable ASCII range
        ascii += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'
      }
      result.push({
        offset: i,
        offsetHex: i.toString(16).padStart(8, '0'),
        hex,
        ascii,
      })
    }
    return result
  })

  let isTruncated = $derived(content.length > PREVIEW_BYTES)
  let displayName = $derived(filename.split('/').pop() ?? 'file')

  function handleDownload() {
    const blob = new Blob([content])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = displayName
    a.click()
    URL.revokeObjectURL(url)
  }
</script>

<div class="fallback-viewer">
  <div class="fallback-header">
    <div class="fallback-title">
      <span class="fallback-name">{displayName}</span>
      <span class="fallback-size">{content.length.toLocaleString()} bytes</span>
    </div>
    <button class="download-btn" onclick={handleDownload}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1a.5.5 0 0 1 .5.5v6.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 0 1 .708-.708L7.5 8.293V1.5A.5.5 0 0 1 8 1zM2 13.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
      </svg>
      Download
    </button>
  </div>
  <div class="hex-dump" aria-label="Hex dump preview">
    <div class="hex-header" aria-hidden="true">
      <span class="hex-col-offset">Offset</span>
      <span class="hex-col-hex">00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f</span>
      <span class="hex-col-ascii">ASCII</span>
    </div>
    {#each rows as row}
      <div class="hex-row">
        <span class="hex-offset">{row.offsetHex}</span>
        <span class="hex-bytes">
          {#each row.hex as byte, j}
            <span class="hex-byte" class:hex-byte--gap={j === 8}>{byte}</span>
          {/each}
          {#each { length: BYTES_PER_ROW - row.hex.length } as _, j (j)}
            <span class="hex-byte hex-byte--empty" class:hex-byte--gap={row.hex.length + j === 8}>  </span>
          {/each}
        </span>
        <span class="hex-ascii">{row.ascii}</span>
      </div>
    {/each}
    {#if isTruncated}
      <div class="hex-truncated">
        … {(content.length - PREVIEW_BYTES).toLocaleString()} more bytes not shown
      </div>
    {/if}
  </div>
  <div class="fallback-footer">
    <p class="fallback-hint">This file type cannot be previewed directly.</p>
    <button class="download-btn download-btn--primary" onclick={handleDownload}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1a.5.5 0 0 1 .5.5v6.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 0 1 .708-.708L7.5 8.293V1.5A.5.5 0 0 1 8 1zM2 13.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
      </svg>
      Download {displayName}
    </button>
  </div>
</div>

<style>
  .fallback-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-bg-base);
    overflow: hidden;
  }

  .fallback-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
    gap: var(--space-3);
    background: var(--color-bg-surface);
  }

  .fallback-title {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .fallback-name {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fallback-size {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .hex-dump {
    flex: 1;
    overflow: auto;
    padding: var(--space-3) var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    line-height: 1.6;
  }

  .hex-header {
    display: flex;
    gap: var(--space-4);
    color: var(--color-text-disabled);
    margin-bottom: var(--space-2);
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--color-border-subtle);
    user-select: none;
  }

  .hex-col-offset {
    width: 8ch;
    flex-shrink: 0;
  }

  .hex-col-hex {
    flex: 1;
    font-size: var(--font-size-xs);
  }

  .hex-col-ascii {
    width: 16ch;
    flex-shrink: 0;
  }

  .hex-row {
    display: flex;
    gap: var(--space-4);
    color: var(--color-text-primary);
  }

  .hex-row:hover {
    background: var(--color-bg-hover);
  }

  .hex-offset {
    width: 8ch;
    flex-shrink: 0;
    color: var(--color-text-disabled);
  }

  .hex-bytes {
    display: flex;
    gap: 1ch;
    flex: 1;
    flex-wrap: nowrap;
  }

  .hex-byte {
    display: inline-block;
    width: 2ch;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
  }

  .hex-byte--gap {
    margin-left: 1ch;
  }

  .hex-byte--empty {
    color: transparent;
  }

  .hex-ascii {
    width: 16ch;
    flex-shrink: 0;
    color: var(--color-text-muted);
    white-space: pre;
  }

  .hex-truncated {
    margin-top: var(--space-2);
    color: var(--color-text-disabled);
    font-style: italic;
    font-size: var(--font-size-xs);
  }

  .fallback-footer {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
    background: var(--color-bg-surface);
  }

  .fallback-hint {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    flex: 1;
  }

  .download-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-elevated);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
    white-space: nowrap;
  }

  .download-btn:hover {
    background: var(--color-bg-input);
    border-color: var(--color-border-focus);
  }

  .download-btn--primary {
    background: var(--color-accent);
    color: var(--color-accent-text);
    border-color: var(--color-accent);
  }

  .download-btn--primary:hover {
    background: var(--color-accent-hover);
    border-color: var(--color-accent-hover);
  }
</style>
