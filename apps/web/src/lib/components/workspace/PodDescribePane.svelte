<script lang="ts">
  import type { PodDescribePaneData } from './WorkspaceTypes.js'
  import Icon from '$lib/components/common/Icon.svelte'

  let { pane, onRefresh }: { pane: PodDescribePaneData; onRefresh: () => void } = $props()
</script>

<div class="pod-describe">
  <div class="pod-describe__toolbar">
    <span class="pod-describe__title">Pod Description</span>
    <button class="pod-describe__btn" onclick={onRefresh} title="Refresh" disabled={pane.loading}>
      <Icon name="refresh" size={13} />
    </button>
  </div>

  {#if pane.loading}
    <div class="pod-describe__state">Loading…</div>
  {:else if !pane.pod}
    <div class="pod-describe__state pod-describe__state--empty">Pod not found</div>
  {:else}
    <div class="pod-describe__body">
      <section class="pod-describe__section">
        <h3 class="pod-describe__heading">Metadata</h3>
        <dl class="pod-describe__dl">
          <dt>Name</dt>
          <dd>{pane.pod.metadata?.name ?? '—'}</dd>
          <dt>Namespace</dt>
          <dd>{pane.pod.metadata?.namespace ?? '—'}</dd>
          <dt>Node</dt>
          <dd>{pane.pod.spec?.nodeName ?? '—'}</dd>
          <dt>Created</dt>
          <dd>{pane.pod.metadata?.creationTimestamp ?? '—'}</dd>
        </dl>
      </section>

      <section class="pod-describe__section">
        <h3 class="pod-describe__heading">Status</h3>
        <dl class="pod-describe__dl">
          <dt>Phase</dt>
          <dd class="pod-describe__phase">{pane.pod.status?.phase ?? '—'}</dd>
          <dt>Pod IP</dt>
          <dd>{pane.pod.status?.podIP ?? '—'}</dd>
          <dt>Host IP</dt>
          <dd>{pane.pod.status?.hostIP ?? '—'}</dd>
          <dt>Start Time</dt>
          <dd>{pane.pod.status?.startTime ?? '—'}</dd>
        </dl>
      </section>

      {#if pane.pod.status?.containerStatuses?.length}
        <section class="pod-describe__section">
          <h3 class="pod-describe__heading">Containers</h3>
          {#each pane.pod.status.containerStatuses as cs (cs.name)}
            <div class="pod-describe__container">
              <div class="pod-describe__container-name">
                {cs.name}
                <span class="pod-describe__badge" class:pod-describe__badge--ok={cs.ready}>
                  {cs.ready ? 'Ready' : 'Not Ready'}
                </span>
              </div>
              <dl class="pod-describe__dl">
                <dt>Restarts</dt>
                <dd>{cs.restartCount ?? 0}</dd>
                <dt>State</dt>
                <dd>
                  {#if cs.state}
                    {Object.keys(cs.state)[0] ?? '—'}
                  {:else}
                    —
                  {/if}
                </dd>
              </dl>
            </div>
          {/each}
        </section>
      {/if}

      {#if pane.pod.status?.conditions?.length}
        <section class="pod-describe__section">
          <h3 class="pod-describe__heading">Conditions</h3>
          <table class="pod-describe__table">
            <thead>
              <tr><th>Type</th><th>Status</th><th>Reason</th><th>Last Transition</th></tr>
            </thead>
            <tbody>
              {#each pane.pod.status.conditions as c (c.type)}
                <tr>
                  <td>{c.type ?? '—'}</td>
                  <td
                    class:pod-describe__ok={c.status === 'True'}
                    class:pod-describe__fail={c.status === 'False'}>{c.status ?? '—'}</td
                  >
                  <td>{c.reason ?? '—'}</td>
                  <td>{c.lastTransitionTime ?? '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/if}
    </div>
  {/if}
</div>

<style>
  .pod-describe {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--color-bg-base);
  }

  .pod-describe__toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-3);
    height: 30px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg-surface);
  }

  .pod-describe__title {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .pod-describe__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1);
    color: var(--color-text-muted);
    border-radius: var(--radius-sm);
    transition:
      color var(--transition-fast),
      background var(--transition-fast);
  }

  .pod-describe__btn:hover:not(:disabled) {
    color: var(--color-text-primary);
    background: var(--color-bg-hover);
  }

  .pod-describe__btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .pod-describe__state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .pod-describe__body {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .pod-describe__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .pod-describe__heading {
    margin: 0;
    font-size: var(--font-size-xs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-muted);
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .pod-describe__dl {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    font-size: var(--font-size-sm);
  }

  .pod-describe__dl dt {
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .pod-describe__dl dd {
    margin: 0;
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    word-break: break-all;
  }

  .pod-describe__phase {
    text-transform: capitalize;
  }

  .pod-describe__container {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .pod-describe__container-name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--color-text-primary);
  }

  .pod-describe__badge {
    font-family: var(--font-sans);
    font-size: var(--font-size-xs);
    font-weight: 500;
    padding: 1px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-bg-elevated);
    color: var(--color-text-muted);
  }

  .pod-describe__badge--ok {
    background: color-mix(in srgb, var(--color-success) 15%, transparent);
    color: var(--color-success);
  }

  .pod-describe__table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-xs);
  }

  .pod-describe__table th {
    text-align: left;
    padding: var(--space-1) var(--space-2);
    color: var(--color-text-muted);
    font-weight: 600;
    border-bottom: 1px solid var(--color-border);
  }

  .pod-describe__table td {
    padding: var(--space-1) var(--space-2);
    color: var(--color-text-primary);
    border-bottom: 1px solid var(--color-border-subtle);
    font-family: var(--font-mono);
  }

  .pod-describe__ok {
    color: var(--color-success);
  }

  .pod-describe__fail {
    color: var(--color-danger, #e53e3e);
  }
</style>
