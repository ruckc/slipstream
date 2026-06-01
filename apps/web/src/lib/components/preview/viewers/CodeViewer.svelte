<script lang="ts">
  import { getHighlighter, extensionToLang } from '$lib/highlight'
  import type { ThemedToken } from 'shiki'

  let { code, filename = '' }: { code: string; filename?: string } = $props()

  let lines = $state<ThemedToken[][]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)

  $effect(() => {
    // Re-run when code or filename changes
    const _code = code
    const _filename = filename
    loading = true
    error = null

    const lang = extensionToLang(_filename)

    getHighlighter()
      .then((h) => {
        try {
          const result = h.codeToTokens(_code, {
            lang: lang as Parameters<typeof h.codeToTokens>[1]['lang'],
            theme: 'css-variables',
          })
          lines = result.tokens
        } catch {
          // Language not loaded or unknown — fall back to plain text tokens
          lines = _code.split('\n').map((line) => [
            {
              content: line,
              color: undefined,
              offset: 0,
              fontStyle: 0,
            } as ThemedToken,
          ])
        }
        loading = false
      })
      .catch(() => {
        error = 'Failed to initialize syntax highlighter'
        loading = false
      })
  })

  let lineCount = $derived(lines.length)
</script>

{#if loading}
  <div class="code-loading">
    <span class="code-spinner" aria-label="Loading syntax highlight"></span>
  </div>
{:else if error}
  <div class="code-error" role="alert">{error}</div>
{:else}
  <div class="code-viewer-wrap">
    <pre class="code-viewer"><code class="code-inner"
        >{#each lines as line, i (i)}<div
            class="line"
            data-line={i + 1}>{#each line as token, ti (ti)}<span
                style:color={token.color ?? undefined}
                style:font-style={token.fontStyle === 1 ? 'italic' : undefined}
                style:font-weight={token.fontStyle === 2 ? 'bold' : undefined}>{token.content}</span
              >{/each}
</div>{/each}</code
      ></pre>
    <div class="code-meta">
      {lineCount} line{lineCount !== 1 ? 's' : ''}
    </div>
  </div>
{/if}

<style>
  .code-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 80px;
  }

  .code-spinner {
    display: block;
    width: 20px;
    height: 20px;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .code-error {
    padding: var(--space-4);
    font-size: var(--font-size-sm);
    color: var(--color-danger);
  }

  .code-viewer-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--color-bg-base);
  }

  .code-viewer {
    flex: 1;
    overflow: auto;
    margin: 0;
    padding: var(--space-4) 0;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    line-height: 1.6;
    counter-reset: line;
    color: var(--shiki-color-text);
    background: transparent;
    tab-size: 2;
  }

  .code-inner {
    display: block;
  }

  .line {
    display: block;
    padding: 0 var(--space-4) 0 0;
    min-height: 1.6em;
    position: relative;
  }

  .line::before {
    counter-increment: line;
    content: counter(line);
    display: inline-block;
    width: 3ch;
    min-width: 3ch;
    margin-right: var(--space-4);
    padding-right: var(--space-2);
    text-align: right;
    color: var(--color-text-disabled);
    user-select: none;
    font-variant-numeric: tabular-nums;
    border-right: 1px solid var(--color-border-subtle);
  }

  .line:hover {
    background: var(--color-bg-hover);
  }

  .code-meta {
    flex-shrink: 0;
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-xs);
    color: var(--color-text-disabled);
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-bg-surface);
  }
</style>
