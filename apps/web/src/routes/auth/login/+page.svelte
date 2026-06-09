<script lang="ts">
  import { getLoginData } from './login.remote'

  const data = await getLoginData({})
</script>

<div class="page">
  <div class="card">
    <h1>Sign in to Slipstream</h1>

    {#if data.error}
      <div class="error-banner" role="alert">
        {#if data.error === 'auth_failed'}
          Authentication failed. Please try again.
        {:else}
          {data.error}
        {/if}
      </div>
    {/if}

    {#if data.providers.length === 0}
      <p class="no-providers">No authentication providers configured.</p>
    {:else}
      <div class="providers">
        {#each data.providers as provider (provider)}
          <a href="/auth/login/{provider}" class="provider-btn">
            <span class="provider-icon" aria-hidden="true">
              {#if provider === 'google'}
                <svg viewBox="0 0 48 48" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
              {:else if provider === 'microsoft'}
                <svg viewBox="0 0 21 21" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                  <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                  <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                  <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                </svg>
              {:else if provider === 'github'}
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"
                  />
                </svg>
              {:else}
                <svg
                  viewBox="0 0 16 16"
                  width="20"
                  height="20"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect x="2" y="2" width="12" height="12" rx="2" />
                </svg>
              {/if}
            </span>
            <span>Continue with {data.providerLabels[provider]}</span>
          </a>
        {/each}
      </div>
    {/if}

    {#if data.devMode}
      <div class="dev-link">
        <a href="/auth/dev">Developer login →</a>
      </div>
    {/if}
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
    max-width: 400px;
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

  .error-banner {
    background: var(--color-error-bg, #3b1219);
    border: 1px solid var(--color-error-border, #7f1d1d);
    color: var(--color-error-text, #fca5a5);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    text-align: center;
  }

  .providers {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .provider-btn {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--color-btn-bg, #252836);
    border: 1px solid var(--color-border, #2a2d3a);
    border-radius: 8px;
    color: var(--color-text, #e2e8f0);
    text-decoration: none;
    font-size: 0.9375rem;
    font-weight: 500;
    transition:
      background 0.15s,
      border-color 0.15s;
    cursor: pointer;
  }

  .provider-btn:hover {
    background: var(--color-btn-bg-hover, #2e3248);
    border-color: var(--color-border-hover, #3d4166);
  }

  .provider-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
  }

  .no-providers {
    color: var(--color-text-muted, #94a3b8);
    font-size: 0.875rem;
    text-align: center;
    margin: 0;
  }

  .dev-link {
    text-align: center;
    border-top: 1px solid var(--color-border, #2a2d3a);
    padding-top: 1rem;
  }

  .dev-link a {
    color: var(--color-text-muted, #64748b);
    font-size: 0.8125rem;
    text-decoration: none;
    transition: color 0.15s;
  }

  .dev-link a:hover {
    color: var(--color-text, #e2e8f0);
  }
</style>
