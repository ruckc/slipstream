<script lang="ts">
  import Icon from './Icon.svelte'
  import Tooltip from './Tooltip.svelte'
  import { updateThemePreference } from '$lib/remote/auth.remote'

  type ThemeValue = 'system' | 'light' | 'dark'

  let current = $state<ThemeValue>('system')

  $effect(() => {
    const stored = localStorage.getItem('theme') as ThemeValue | null
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      current = stored
    } else {
      current = 'system'
    }
    applyTheme(current)
  })

  function applyTheme(theme: ThemeValue) {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
    }
  }

  function select(theme: ThemeValue) {
    current = theme
    localStorage.setItem('theme', theme)
    applyTheme(theme)
    updateThemePreference(theme)
  }

  const options: Array<{ value: ThemeValue; label: string; icon: string }> = [
    { value: 'system', label: 'System', icon: 'monitor' },
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
  ]
</script>

<div class="theme-picker" role="group" aria-label="Color theme">
  {#each options as opt (opt.value)}
    <Tooltip text={opt.label} position="top" delay={300}>
      <button
        class="theme-btn"
        class:theme-btn--active={current === opt.value}
        onclick={() => select(opt.value)}
        aria-pressed={current === opt.value}
        aria-label="{opt.label} theme"
        type="button"
      >
        <Icon name={opt.icon} size={14} />
      </button>
    </Tooltip>
  {/each}
</div>

<style>
  .theme-picker {
    display: flex;
    align-items: center;
    gap: 1px;
    background: var(--color-bg-input);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 2px;
  }

  .theme-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 22px;
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    transition:
      background var(--transition-fast),
      color var(--transition-fast);
  }

  .theme-btn:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }

  .theme-btn--active {
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
  }
</style>
