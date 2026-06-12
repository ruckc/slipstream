<script lang="ts">
  import Modal from '$lib/components/common/Modal.svelte'
  import Button from '$lib/components/common/Button.svelte'
  import type { ProjectCommand } from '$lib/server/db'

  let {
    open = $bindable(false),
    savedCommands,
    onconfirm,
  }: {
    open?: boolean
    savedCommands: ProjectCommand[]
    onconfirm: (command: string | null, workingDir: string | null) => void
  } = $props()

  type Choice = 'bash' | 'saved' | 'other'

  let choice = $state<Choice>('bash')
  let selectedSavedId = $state<string>('')
  let otherCommand = $state('')
  let workingDir = $state('')

  $effect(() => {
    if (!open) {
      choice = 'bash'
      selectedSavedId = ''
      otherCommand = ''
      workingDir = ''
    }
  })

  function handleConfirm() {
    let cmd: string | null = null
    if (choice === 'saved') {
      const found = savedCommands.find((c) => c.id === selectedSavedId)
      cmd = found?.command ?? null
    } else if (choice === 'other') {
      const trimmed = otherCommand.trim()
      if (!trimmed) return
      cmd = trimmed
    }
    const dir = workingDir.trim() || null
    open = false
    onconfirm(cmd, dir)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleConfirm()
  }
</script>

<Modal bind:open title="New Session">
  <div class="new-session-form" onkeydown={handleKeydown} role="presentation">
    <fieldset class="choice-group">
      <legend class="choice-legend">Run</legend>
      <div class="choice-list">
        <label class="choice-option">
          <input type="radio" name="cmd-choice" value="bash" bind:group={choice} />
          <span>bash (default shell)</span>
        </label>

        {#each savedCommands as saved (saved.id)}
          <label class="choice-option">
            <input
              type="radio"
              name="cmd-choice"
              value="saved"
              bind:group={choice}
              onclick={() => {
                choice = 'saved'
                selectedSavedId = saved.id
              }}
              checked={choice === 'saved' && selectedSavedId === saved.id}
            />
            <span class="saved-label">{saved.label ?? saved.command}</span>
            <code class="saved-command">{saved.command}</code>
          </label>
        {/each}

        <label class="choice-option choice-option--other">
          <input type="radio" name="cmd-choice" value="other" bind:group={choice} />
          <input
            class="other-input"
            type="text"
            placeholder="Other…"
            bind:value={otherCommand}
            aria-label="Command to run"
            onfocus={() => (choice = 'other')}
            oninput={() => (choice = 'other')}
          />
        </label>
      </div>
    </fieldset>

    <label class="field-label">
      Working directory <span class="field-hint">(optional, defaults to /workspace)</span>
      <input
        class="dir-input"
        type="text"
        placeholder="/workspace"
        bind:value={workingDir}
        aria-label="Working directory"
      />
    </label>
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button
      variant="primary"
      onclick={handleConfirm}
      disabled={choice === 'other' && !otherCommand.trim()}
    >
      Start
    </Button>
  {/snippet}
</Modal>

<style>
  .new-session-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .choice-group {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    min-width: 0;
  }

  .choice-legend {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--color-text-secondary);
    padding: 0 var(--space-1);
  }

  .choice-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .choice-option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .choice-option--other {
    align-items: center;
  }

  .saved-label {
    font-weight: 500;
  }

  .saved-command {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

  .other-input {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    background: var(--color-bg-input);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
  }

  .other-input:focus {
    border-color: var(--color-border-focus);
    outline: none;
  }

  .dir-input {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    background: var(--color-bg-input);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    width: 100%;
    margin-top: var(--space-1);
  }

  .dir-input:focus {
    border-color: var(--color-border-focus);
    outline: none;
  }

  .field-label {
    display: flex;
    flex-direction: column;
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    font-weight: 500;
  }

  .field-hint {
    font-weight: 400;
    color: var(--color-text-muted);
  }
</style>
