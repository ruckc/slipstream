<script lang="ts">
  import { page } from '$app/state'

  let { children }: { children: import('svelte').Snippet } = $props()

  const navLinks = [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/errors', label: 'Errors' },
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/infra', label: 'Infra' },
  ]
</script>

<div class="admin-shell">
  <nav class="admin-nav">
    <span class="admin-nav__title">Admin</span>
    {#each navLinks as link (link.href)}
      <a
        href={link.href}
        class="admin-nav__link"
        class:admin-nav__link--active={page.url.pathname === link.href ||
          (link.href !== '/admin' && page.url.pathname.startsWith(link.href))}
      >
        {link.label}
      </a>
    {/each}
  </nav>

  <main class="admin-main">
    {@render children()}
  </main>
</div>

<style>
  .admin-shell {
    display: flex;
    min-height: calc(100vh - 35px);
  }

  .admin-nav {
    width: 160px;
    flex-shrink: 0;
    background: var(--color-bg-surface);
    border-right: 1px solid var(--color-border);
    padding: var(--space-4) 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .admin-nav__title {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: var(--space-2) var(--space-4);
    margin-bottom: var(--space-2);
  }

  .admin-nav__link {
    display: block;
    padding: var(--space-2) var(--space-4);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-decoration: none;
    border-left: 2px solid transparent;
  }

  .admin-nav__link:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-hover);
    text-decoration: none;
  }

  .admin-nav__link--active {
    color: var(--color-text-primary);
    border-left-color: var(--color-accent);
    background: var(--color-bg-active);
  }

  .admin-main {
    flex: 1;
    min-width: 0;
    padding: var(--space-6);
    overflow-y: auto;
  }
</style>
