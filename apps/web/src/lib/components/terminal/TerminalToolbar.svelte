<script lang="ts">
  import Button from '$lib/components/common/Button.svelte'
  import Icon from '$lib/components/common/Icon.svelte'

  let {
    sessionLabel,
    onClear,
    onRename,
    onKill,
  }: {
    sessionLabel: string
    onClear: () => void
    onRename: (newLabel: string) => void
    onKill: () => void
  } = $props()

  let renaming = $state(false)
  let renameValue = $state('')

  function startRename() {
    renameValue = sessionLabel
    renaming = true
  }

  function commitRename() {
    const trimmed = renameValue.trim()
    if (trimmed) onRename(trimmed)
    renaming = false
  }

  function cancelRename() {
    renaming = false
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitRename()
    else if (e.key === 'Escape') cancelRename()
  }
</script>

<div class="terminal-toolbar">
  <div class="terminal-toolbar-left">
    {#if renaming}
      <input
        class="rename-input"
        bind:value={renameValue}
        onblur={commitRename}
        onkeydown={handleRenameKeydown}
        aria-label="Rename terminal"
        maxlength={64}
      />
    {:else}
      <span class="terminal-toolbar-label" ondblclick={startRename} title="Double-click to rename">
        {sessionLabel}
      </span>
    {/if}
  </div>
  <div class="terminal-toolbar-right">
    <Button variant="ghost" size="sm" onclick={onClear} title="Clear terminal output">
      <Icon name="trash" size={12} />
      Clear
    </Button>
    <Button variant="ghost" size="sm" onclick={startRename} title="Rename session">
      <Icon name="edit" size={12} />
      Rename
    </Button>
    <Button variant="ghost" size="sm" onclick={onKill} title="Kill terminal session">
      <Icon name="stop" size={12} />
      Kill
    </Button>
  </div>
</div>

<style>
  .terminal-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-3);
    height: 30px;
    background: var(--color-bg-elevated);
    border-bottom: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
    gap: var(--space-2);
  }

  .terminal-toolbar-left {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .terminal-toolbar-label {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
  }

  .rename-input {
    font-family: var(--font-sans);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    background: var(--color-bg-input);
    border: 1px solid var(--color-border-focus);
    border-radius: var(--radius-sm);
    padding: 1px var(--space-2);
    height: 22px;
    width: 200px;
    max-width: 100%;
  }

  .terminal-toolbar-right {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
</style>
