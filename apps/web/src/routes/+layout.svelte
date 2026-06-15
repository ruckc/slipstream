<script lang="ts">
  import '../app.css'
  import type { LayoutData } from './$types'

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props()

  // Apply theme from user preference before first paint
  $effect(() => {
    const pref = data.user?.themePreference ?? 'system'
    if (pref === 'system') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', pref)
    }
  })
</script>

<svelte:head>
  <title>Slipstream</title>
  <meta name="description" content="Cloud dev environments, powered by Kubernetes" />
</svelte:head>

{#if data.user}
  <div class="app-root">
    <header class="top-bar">
      <a href="/" class="top-bar__logo" aria-label="Slipstream home">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
            fill="none"
          />
        </svg>
        <span class="top-bar__name">Slipstream</span>
      </a>

      <nav class="top-bar__nav">
        {#if data.user.role === 'admin'}
          <a href="/admin" class="top-bar__link top-bar__admin-link">Admin</a>
        {/if}
        <a href="/settings" class="top-bar__link" aria-label="User settings">
          {#if data.user.avatarUrl}
            <img src={data.user.avatarUrl} alt={data.user.displayName} class="top-bar__avatar" />
          {:else}
            <span class="top-bar__avatar-placeholder">
              {data.user.displayName.charAt(0).toUpperCase()}
            </span>
          {/if}
        </a>
      </nav>
    </header>

    <main class="app-main">
      {@render children()}
    </main>
  </div>
{:else}
  {@render children()}
{/if}

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--font-size-base);
    color: var(--color-text-primary);
    background: var(--color-bg-base);
    -webkit-font-smoothing: antialiased;
  }

  :global(a) {
    color: var(--color-text-link);
    text-decoration: none;
  }

  :global(a:hover) {
    text-decoration: underline;
  }

  .app-root {
    display: flex;
    flex-direction: column;
    height: 100vh; /* fallback for browsers without dvh support */
    height: 100dvh; /* track the visible viewport so mobile browser chrome doesn't clip the keyboard */
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 35px;
    padding: 0 var(--space-4);
    background: var(--color-bg-surface);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .top-bar__logo {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-decoration: none;
    min-width: 0;
  }

  .top-bar__logo:hover {
    text-decoration: none;
    color: var(--color-accent);
  }

  .top-bar__name {
    letter-spacing: 0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .top-bar__nav {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .top-bar__admin-link {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--color-text-muted);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
  }

  .top-bar__admin-link:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-hover);
    text-decoration: none;
  }

  .top-bar__link {
    display: flex;
    align-items: center;
    color: var(--color-text-primary);
    text-decoration: none;
  }

  .top-bar__avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
  }

  .top-bar__avatar-placeholder {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--color-accent);
    color: var(--color-accent-text);
    font-size: var(--font-size-xs);
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .app-main {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
</style>
