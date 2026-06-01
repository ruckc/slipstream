<script lang="ts">
  import { untrack } from 'svelte'
  import { enhance } from '$app/forms'
  import type { PageData, ActionData } from './$types'
  import Button from '$lib/components/common/Button.svelte'
  import Input from '$lib/components/common/Input.svelte'
  import ThemePicker from '$lib/components/common/ThemePicker.svelte'
  import Icon from '$lib/components/common/Icon.svelte'

  let { data, form }: { data: PageData; form: ActionData } = $props()

  let displayName = $state(untrack(() => data.user.displayName))
  let avatarUrl = $state(untrack(() => data.user.avatarUrl ?? ''))
  let profileLoading = $state(false)

  let idleTimeout = $state(untrack(() => String(data.user.idleTimeoutSeconds ?? '')))
  let timeoutLoading = $state(false)

  const PROVIDER_LABELS: Record<string, string> = {
    google: 'Google',
    microsoft: 'Microsoft',
    github: 'GitHub',
  }
</script>

<svelte:head>
  <title>Settings — Slipstream</title>
</svelte:head>

<div class="settings-page">
  <div class="settings-header">
    <a href="/" class="back-link">
      <Icon name="chevron-right" size={12} />
      Dashboard
    </a>
    <h1 class="settings-title">User Settings</h1>
  </div>

  <div class="settings-sections">
    <!-- Profile -->
    <section class="settings-section">
      <h2 class="section-title">Profile</h2>
      <form
        method="POST"
        action="?/updateProfile"
        class="section-form"
        use:enhance={() => {
          profileLoading = true
          return async ({ update }) => {
            profileLoading = false
            await update()
          }
        }}
      >
        <div class="avatar-preview">
          {#if avatarUrl}
            <img src={avatarUrl} alt={displayName} class="avatar-img" />
          {:else}
            <span class="avatar-placeholder">
              {displayName.charAt(0).toUpperCase()}
            </span>
          {/if}
        </div>

        <Input label="Display name" name="displayName" bind:value={displayName} required />
        <Input
          label="Avatar URL"
          name="avatarUrl"
          bind:value={avatarUrl}
          placeholder="https://example.com/avatar.png"
        />

        {#if form?.profile && form?.error}
          <div class="form-error" role="alert">{form.error}</div>
        {/if}
        {#if form?.profile && form?.success}
          <div class="form-success" role="status">Profile updated.</div>
        {/if}

        <div class="form-actions">
          <Button type="submit" variant="primary" loading={profileLoading}>Save profile</Button>
        </div>
      </form>
    </section>

    <!-- Theme -->
    <section class="settings-section">
      <h2 class="section-title">Appearance</h2>
      <p class="section-desc">Choose your preferred color theme.</p>
      <div class="theme-row">
        <span class="theme-label">Color theme</span>
        <ThemePicker />
      </div>
      <p class="section-desc section-desc--small">
        Theme preference is saved in your browser and synced via your account.
      </p>
    </section>

    <!-- Idle timeout -->
    <section class="settings-section">
      <h2 class="section-title">Idle timeout</h2>
      <p class="section-desc">
        Default idle timeout for your projects (seconds). Leave blank to use the system default
        (1800s = 30 min).
      </p>
      <form
        method="POST"
        action="?/updateIdleTimeout"
        class="section-form"
        use:enhance={() => {
          timeoutLoading = true
          return async ({ update }) => {
            timeoutLoading = false
            await update()
          }
        }}
      >
        <Input
          label="Idle timeout (seconds)"
          name="idleTimeoutSeconds"
          type="text"
          bind:value={idleTimeout}
          placeholder="1800 (system default)"
          error={form?.timeout && form?.error ? form.error : undefined}
        />
        {#if form?.timeout && form?.success}
          <div class="form-success" role="status">Saved.</div>
        {/if}
        <div class="form-actions">
          <Button type="submit" variant="primary" loading={timeoutLoading}>Save</Button>
        </div>
      </form>
    </section>

    <!-- Linked accounts -->
    <section class="settings-section">
      <h2 class="section-title">Linked accounts</h2>
      <p class="section-desc">Sign-in providers linked to your account.</p>

      {#if data.connections.length === 0}
        <p class="connections-empty">No linked providers.</p>
      {:else}
        <div class="connections-list">
          {#each data.connections as conn (conn.id)}
            <div class="connection-row">
              <div class="connection-info">
                <Icon name="key" size={14} />
                <div>
                  <div class="connection-provider">
                    {PROVIDER_LABELS[conn.provider] ?? conn.provider}
                  </div>
                  {#if conn.email}
                    <div class="connection-email">{conn.email}</div>
                  {/if}
                  {#if conn.linkedAt}
                    <div class="connection-date">
                      Linked {new Date(conn.linkedAt).toLocaleDateString()}
                    </div>
                  {/if}
                </div>
              </div>
              {#if data.connections.length > 1}
                <form method="POST" action="?/unlinkProvider" use:enhance>
                  <input type="hidden" name="connectionId" value={conn.id} />
                  <Button type="submit" variant="ghost" size="sm">Unlink</Button>
                </form>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <div class="link-providers">
        <p class="section-desc section-desc--small">Link another provider:</p>
        <div class="provider-links">
          {#each ['google', 'microsoft', 'github'] as provider (provider)}
            {@const alreadyLinked = data.connections.some((c) => c.provider === provider)}
            <a
              href={alreadyLinked ? undefined : `/auth/login/${provider}`}
              class="provider-link"
              class:provider-link--linked={alreadyLinked}
              aria-disabled={alreadyLinked}
              title={alreadyLinked ? 'Already linked' : `Link ${PROVIDER_LABELS[provider]}`}
            >
              <Icon name="key" size={12} />
              {PROVIDER_LABELS[provider]}
              {#if alreadyLinked}
                <Icon name="check" size={10} />
              {/if}
            </a>
          {/each}
        </div>
      </div>
    </section>

    <!-- Account info -->
    <section class="settings-section">
      <h2 class="section-title">Account</h2>
      <div class="account-info">
        <div class="account-row">
          <span class="account-label">User ID</span>
          <code class="account-value">{data.user.id}</code>
        </div>
        <div class="account-row">
          <span class="account-label">Email</span>
          <span class="account-value">{data.user.email}</span>
        </div>
        <div class="account-row">
          <span class="account-label">Namespace</span>
          <a href="/{data.user.namespaceId}" class="account-value account-value--link">
            Personal namespace
          </a>
        </div>
        {#if data.user.createdAt}
          <div class="account-row">
            <span class="account-label">Member since</span>
            <span class="account-value">{new Date(data.user.createdAt).toLocaleDateString()}</span>
          </div>
        {/if}
      </div>
      <div class="signout">
        <a href="/auth/logout" class="signout-link">Sign out</a>
      </div>
    </section>
  </div>
</div>

<style>
  .settings-page {
    max-width: 640px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
  }

  .settings-header {
    margin-bottom: var(--space-8);
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-decoration: none;
    margin-bottom: var(--space-3);
  }

  .back-link:hover {
    color: var(--color-text-primary);
  }

  .settings-title {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .settings-sections {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .settings-section {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    background: var(--color-bg-surface);
  }

  .section-title {
    margin: 0 0 var(--space-3);
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .section-desc {
    margin: 0 0 var(--space-4);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .section-desc--small {
    font-size: var(--font-size-xs);
    margin-bottom: var(--space-2);
  }

  .section-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 400px;
  }

  .form-actions {
    display: flex;
    justify-content: flex-start;
  }

  .form-error {
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    color: var(--color-danger);
  }

  .form-success {
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--color-success) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-success) 30%, transparent);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    color: var(--color-success);
  }

  /* Avatar */
  .avatar-preview {
    margin-bottom: var(--space-2);
  }

  .avatar-img {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    object-fit: cover;
  }

  .avatar-placeholder {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--color-accent);
    color: var(--color-accent-text);
    font-size: var(--font-size-lg);
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Theme */
  .theme-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }

  .theme-label {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  /* Connections */
  .connections-empty {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    margin: 0 0 var(--space-4);
  }

  .connections-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }

  .connection-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-bg-elevated);
    border-radius: var(--radius-md);
  }

  .connection-info {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--color-text-muted);
  }

  .connection-provider {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--color-text-primary);
  }

  .connection-email,
  .connection-date {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  /* Link providers */
  .link-providers {
    margin-top: var(--space-3);
  }

  .provider-links {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .provider-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--color-text-primary);
    text-decoration: none;
    height: 26px;
    transition: all var(--transition-fast);
  }

  .provider-link:hover:not(.provider-link--linked) {
    background: var(--color-bg-input);
    border-color: var(--color-border-focus);
    text-decoration: none;
  }

  .provider-link--linked {
    opacity: 0.6;
    cursor: default;
    color: var(--color-success);
    border-color: color-mix(in srgb, var(--color-success) 30%, transparent);
    background: color-mix(in srgb, var(--color-success) 8%, transparent);
  }

  /* Account info */
  .account-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }

  .account-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .account-label {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    min-width: 100px;
    flex-shrink: 0;
  }

  .account-value {
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    word-break: break-all;
  }

  .account-value--link {
    color: var(--color-text-link);
    text-decoration: none;
    font-family: var(--font-sans);
  }

  .account-value--link:hover {
    text-decoration: underline;
  }

  .signout {
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
  }

  .signout-link {
    font-size: var(--font-size-sm);
    color: var(--color-danger);
    text-decoration: none;
  }

  .signout-link:hover {
    text-decoration: underline;
  }
</style>
