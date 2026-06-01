<script lang="ts">
  import type { Tokens } from 'marked'
  import MarkdownInline from './MarkdownInline.svelte'

  let { token }: { token: Tokens.Table } = $props()

  type Align = 'center' | 'left' | 'right' | null

  function alignStyle(align: Align): string | undefined {
    if (align === 'center') return 'center'
    if (align === 'left') return 'left'
    if (align === 'right') return 'right'
    return undefined
  }
</script>

<div class="md-table-wrap">
  <table class="md-table">
    <thead>
      <tr>
        {#each token.header as cell, i}
          <th
            class="md-th"
            style:text-align={alignStyle(token.align[i] as Align)}
          >
            <MarkdownInline tokens={cell.tokens ?? []} />
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each token.rows as row}
        <tr class="md-tr">
          {#each row as cell, i}
            <td
              class="md-td"
              style:text-align={alignStyle(token.align[i] as Align)}
            >
              <MarkdownInline tokens={cell.tokens ?? []} />
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .md-table-wrap {
    width: 100%;
    overflow-x: auto;
    margin: 1em 0;
  }

  .md-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
  }

  .md-th {
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    font-weight: 600;
    white-space: nowrap;
  }

  .md-td {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-subtle);
    vertical-align: top;
    line-height: 1.5;
  }

  .md-tr:nth-child(even) {
    background: rgba(255, 255, 255, 0.02);
  }

  .md-tr:hover {
    background: var(--color-bg-hover);
  }
</style>
