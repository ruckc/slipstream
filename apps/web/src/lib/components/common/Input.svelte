<script lang="ts">
  let {
    label,
    value = $bindable(''),
    error,
    placeholder,
    type = 'text',
    name,
    required = false,
  }: {
    label: string
    value?: string
    error?: string
    placeholder?: string
    type?: 'text' | 'email' | 'password'
    name?: string
    required?: boolean
  } = $props()

  const inputId = $derived(`input-${label.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`)
</script>

<div class="input-field" class:input-field--error={!!error}>
  <label class="input-label" for={inputId}>
    {label}
    {#if required}
      <span class="input-required" aria-label="required">*</span>
    {/if}
  </label>
  <input
    id={inputId}
    class="input"
    {type}
    {name}
    {placeholder}
    {required}
    bind:value
    aria-invalid={!!error}
    aria-describedby={error ? `${inputId}-error` : undefined}
  />
  {#if error}
    <span id="{inputId}-error" class="input-error" role="alert">{error}</span>
  {/if}
</div>

<style>
  .input-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .input-label {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .input-required {
    color: var(--color-danger);
    margin-left: 2px;
  }

  .input {
    background: var(--color-bg-input);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-sm);
    font-family: var(--font-sans);
    height: 28px;
    width: 100%;
    transition: border-color var(--transition-fast);
  }

  .input:focus {
    border-color: var(--color-border-focus);
    outline: none;
  }

  .input::placeholder {
    color: var(--color-text-disabled);
  }

  .input-field--error .input {
    border-color: var(--color-danger);
  }

  .input-field--error .input:focus {
    border-color: var(--color-danger);
  }

  .input-error {
    font-size: var(--font-size-xs);
    color: var(--color-danger);
    line-height: 1.3;
  }
</style>
