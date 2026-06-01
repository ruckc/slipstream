<script lang="ts">
  import type { PageData, ActionData } from './$types'

  let { data, form }: { data: PageData; form: ActionData } = $props()
</script>

<div class="page">
  <div class="card">
    <h1>Developer Login</h1>
    <p class="subtitle">Select a dev account to log in as</p>

    {#if form?.error}
      <div class="error-banner" role="alert">{form.error}</div>
    {/if}

    {#if data.accounts.length === 0}
      <div class="empty">
        <p>No dev accounts found.</p>
        <code>Run: pnpm db:seed:dev</code>
      </div>
    {:else}
      <div class="accounts">
        {#each data.accounts as account}
          <div class="account-card">
            <div class="account-info">
              <span class="account-name">{account.displayName}</span>
              <span class="account-email">{account.email}</span>
            </div>
            <form method="POST" action="?/login">
              <input type="hidden" name="uuid" value={account.id} />
              <button type="submit" class="login-btn">
                Login as {account.displayName}
              </button>
            </form>
          </div>
        {/each}
      </div>
    {/if}

    <div class="back-link">
      <a href="/auth/login">← Back to login</a>
    </div>
  </div>
</div>

<style>
  .page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-bg, #0f1117);
    padding: 1rem;
  }

  .card {
    background: var(--color-surface, #1a1d27);
    border: 1px solid var(--color-border, #2a2d3a);
    border-radius: 12px;
    padding: 2.5rem 2rem;
    width: 100%;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--color-text, #e2e8f0);
    text-align: center;
  }

  .subtitle {
    margin: -0.75rem 0 0;
    font-size: 0.875rem;
    color: var(--color-text-muted, #64748b);
    text-align: center;
  }

  .error-banner {
    background: var(--color-error-bg, #3b1219);
    border: 1px solid var(--color-error-border, #7f1d1d);
    color: var(--color-error-text, #fca5a5);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    text-align: center;
  }

  .empty {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1.5rem 0;
  }

  .empty p {
    margin: 0;
    color: var(--color-text-muted, #94a3b8);
    font-size: 0.9375rem;
  }

  .empty code {
    display: inline-block;
    background: var(--color-code-bg, #0f1117);
    border: 1px solid var(--color-border, #2a2d3a);
    border-radius: 6px;
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    color: var(--color-code-text, #a5b4fc);
    font-family: ui-monospace, 'Cascadia Code', monospace;
  }

  .accounts {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .account-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.875rem 1rem;
    background: var(--color-btn-bg, #252836);
    border: 1px solid var(--color-border, #2a2d3a);
    border-radius: 8px;
  }

  .account-info {
    display: flex;
    flex-direction: column;
    gap: 0.1875rem;
    min-width: 0;
  }

  .account-name {
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--color-text, #e2e8f0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .account-email {
    font-size: 0.8125rem;
    color: var(--color-text-muted, #64748b);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .login-btn {
    flex-shrink: 0;
    padding: 0.5rem 0.875rem;
    background: var(--color-accent, #4f46e5);
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
  }

  .login-btn:hover {
    background: var(--color-accent-hover, #4338ca);
  }

  .back-link {
    text-align: center;
    border-top: 1px solid var(--color-border, #2a2d3a);
    padding-top: 1rem;
  }

  .back-link a {
    color: var(--color-text-muted, #64748b);
    font-size: 0.8125rem;
    text-decoration: none;
    transition: color 0.15s;
  }

  .back-link a:hover {
    color: var(--color-text, #e2e8f0);
  }
</style>
