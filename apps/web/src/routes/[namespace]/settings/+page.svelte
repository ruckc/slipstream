<script lang="ts">
  import { untrack } from 'svelte'
  import { enhance } from '$app/forms'
  import type { PageData, ActionData } from './$types'
  import Button from '$lib/components/common/Button.svelte'
  import Input from '$lib/components/common/Input.svelte'
  import Icon from '$lib/components/common/Icon.svelte'

  let { data, form }: { data: PageData; form: ActionData } = $props()

  const isOrg = $derived(data.type === 'org')

  let inviteEmail = $state('')
  let inviteLoading = $state(false)

  let idleTimeout = $state(
    untrack(() =>
      isOrg
        ? String(data.org?.idleTimeoutSeconds ?? '')
        : String(data.user.idleTimeoutSeconds ?? '')
    )
  )
  let idleLoading = $state(false)

  let orgName = $state(untrack(() => (isOrg ? (data.org?.displayName ?? '') : '')))
  let orgNameLoading = $state(false)
</script>

<svelte:head>
  <title>Settings — {data.namespace.slug} — Slipstream</title>
</svelte:head>

<div class="settings-page">
  <div class="settings-header">
    <a href="/{data.namespace.slug}" class="back-link">
      <Icon name="chevron-right" size={12} />
      {data.namespace.slug}
    </a>
    <h1 class="settings-title">
      {isOrg ? 'Organization Settings' : 'Namespace Settings'}
    </h1>
  </div>

  <div class="settings-sections">
    <!-- Org display name (org only) -->
    {#if isOrg && data.org}
      <section class="settings-section">
        <h2 class="section-title">Organization</h2>
        <form
          method="POST"
          action="?/updateOrgName"
          class="section-form"
          use:enhance={() => {
            orgNameLoading = true
            return async ({ update }) => {
              orgNameLoading = false
              await update()
            }
          }}
        >
          <Input label="Display name" name="displayName" bind:value={orgName} required />
          {#if form?.error && !form?.invite}
            <div class="form-error" role="alert">{form.error}</div>
          {/if}
          {#if form?.success && !form?.invite}
            <div class="form-success" role="status">Saved.</div>
          {/if}
          <div class="form-actions">
            <Button type="submit" variant="primary" loading={orgNameLoading}>Save</Button>
          </div>
        </form>
      </section>
    {/if}

    <!-- Idle timeout -->
    <section class="settings-section">
      <h2 class="section-title">Idle timeout</h2>
      <p class="section-desc">
        Default idle timeout for projects in this namespace (seconds). Leave blank to use the system
        default.
      </p>
      <form
        method="POST"
        action="?/updateIdleTimeout"
        class="section-form"
        use:enhance={() => {
          idleLoading = true
          return async ({ update }) => {
            idleLoading = false
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
        />
        <div class="form-actions">
          <Button type="submit" variant="primary" loading={idleLoading}>Save</Button>
        </div>
      </form>
    </section>

    <!-- Members (org only) -->
    {#if isOrg && data.members}
      <section class="settings-section">
        <h2 class="section-title">Members</h2>

        <div class="member-list">
          {#each data.members as member (member.userId)}
            <div class="member-row">
              <div class="member-info">
                {#if member.user.avatarUrl}
                  <img src={member.user.avatarUrl} alt="" class="member-avatar" />
                {:else}
                  <span class="member-avatar-placeholder">
                    {member.user.displayName.charAt(0).toUpperCase()}
                  </span>
                {/if}
                <div>
                  <div class="member-name">{member.user.displayName}</div>
                  <div class="member-email">{member.user.email}</div>
                </div>
              </div>

              <div class="member-actions">
                <span class="role-badge role-badge--{member.role}">{member.role}</span>
                {#if data.isOwner && member.userId !== data.user.id}
                  <form method="POST" action="?/setMemberRole" use:enhance>
                    <input type="hidden" name="userId" value={member.userId} />
                    <input
                      type="hidden"
                      name="role"
                      value={member.role === 'owner' ? 'member' : 'owner'}
                    />
                    <Button type="submit" variant="ghost" size="sm">
                      Make {member.role === 'owner' ? 'member' : 'owner'}
                    </Button>
                  </form>
                  <form method="POST" action="?/removeMember" use:enhance>
                    <input type="hidden" name="userId" value={member.userId} />
                    <Button type="submit" variant="danger" size="sm">Remove</Button>
                  </form>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <!-- Invite form -->
        <form
          method="POST"
          action="?/inviteMember"
          class="invite-form"
          use:enhance={() => {
            inviteLoading = true
            return async ({ update }) => {
              inviteLoading = false
              inviteEmail = ''
              await update()
            }
          }}
        >
          <Input
            label="Invite by email"
            name="email"
            type="email"
            bind:value={inviteEmail}
            placeholder="user@example.com"
            required
            error={form?.invite && form?.error ? form.error : undefined}
          />
          {#if form?.invite && form?.success}
            <div class="form-success" role="status">Invitation sent.</div>
          {/if}
          <div class="form-actions">
            <Button type="submit" variant="primary" loading={inviteLoading}>
              <Icon name="add" size={12} />
              Invite
            </Button>
          </div>
        </form>
      </section>
    {/if}
  </div>
</div>

<style>
  .settings-page {
    max-width: 680px;
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
    rotate: 180deg;
  }

  .back-link:hover {
    color: var(--color-text-primary);
  }

  /* undo rotate for text */
  .back-link :global(.icon),
  .back-link {
    rotate: 0deg;
  }

  .back-link {
    rotate: 0;
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
    gap: var(--space-8);
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

  /* Members */
  .member-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-4);
  }

  .member-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-bg-elevated);
    flex-wrap: wrap;
  }

  .member-info {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .member-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .member-avatar-placeholder {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--color-accent);
    color: var(--color-accent-text);
    font-size: var(--font-size-sm);
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .member-name {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--color-text-primary);
  }

  .member-email {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .member-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .role-badge {
    font-size: var(--font-size-xs);
    font-weight: 500;
    padding: 1px var(--space-2);
    border-radius: 10px;
  }

  .role-badge--owner {
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    color: var(--color-accent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
  }

  .role-badge--member {
    background: var(--color-bg-input);
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
  }

  .invite-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 400px;
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
  }
</style>
