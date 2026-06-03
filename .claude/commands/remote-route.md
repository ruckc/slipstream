# remote-route

Convert a SvelteKit route from `+page.server.ts` load functions / form actions to remote functions (`query`, `form`, `command`).

**Usage:** `/remote-route [route-path]`

Example: `/remote-route src/routes/new` or `/remote-route [namespace]/[project]`

---

## What to do

Given the route path in `$ARGUMENTS` (or infer from context if not provided):

1. **Read** the existing `+page.server.ts` (load function + actions) and `+page.svelte` for that route.

2. **Create** `<route>/settings.remote.ts` (or `<route>/<name>.remote.ts` — name it after the route, e.g. `page.remote.ts` for top-level pages, `settings.remote.ts` for settings pages).

3. **Write** the remote function file following this pattern:

```ts
import { query, form, command, getRequestEvent } from '$app/server'
import { redirect, error, invalid } from '@sveltejs/kit'
// import DB, server helpers as needed — these are server-only imports, safe in .remote.ts

export const getXxx = query(async () => {
  const { locals } = getRequestEvent()
  if (!locals.user) redirect(302, '/auth/login')
  // fetch and return data
  return { ... }
})

// query with argument (for route params):
export const getXxx = query('unchecked', async (arg: { namespace: string }) => {
  const { locals } = getRequestEvent()
  if (!locals.user) redirect(302, '/auth/login')
  // ...
})

// form (replaces form actions):
export const updateXxx = form(
  'unchecked',
  async (data: { field1: string; field2: string }, issue) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')
    // validate:
    if (!data.field1.trim()) invalid(issue.field1('Field is required'))
    // mutate and return:
    return { success: true as const }
  }
)

// command (imperative mutation, no form element):
export const doXxx = command('unchecked', async (arg: { id: string }) => {
  const { locals } = getRequestEvent()
  if (!locals.user) redirect(302, '/auth/login')
  // mutate
})
```

4. **Rewrite** `+page.svelte` using the remote functions:

```svelte
<script lang="ts">
  import { page } from '$app/state'          // NOT $app/stores
  import { getXxx, updateXxx, doXxx } from './page.remote'

  // For queries with no args:
  const data = await getXxx()

  // For queries that need route params:
  const data = await getXxx(page.params.namespace!)   // note: use ! since param is always present

  let field1 = $state(data.someValue)
</script>

<!-- Forms: spread remote form onto <form> element -->
<form {...updateXxx} class="...">
  <input name="field1" bind:value={field1} />
  <!-- Field validation errors: -->
  {#if updateXxx.fields.field1?.issues()?.[0]?.message}
    <p class="error">{updateXxx.fields.field1.issues()?.[0]?.message}</p>
  {/if}
  <!-- Success state: -->
  {#if updateXxx.result?.success}
    <p>Saved.</p>
  {/if}
  <button type="submit" disabled={updateXxx.pending > 0}>Save</button>
</form>

<!-- Commands: call from onclick -->
<button onclick={() => doXxx({ id: item.id })}>
  {doXxx.pending > 0 ? 'Loading...' : 'Delete'}
</button>
```

5. **Delete** the `+page.server.ts` file (it's fully replaced by the remote file).

6. **Run** `pnpm exec svelte-check --tsconfig ./tsconfig.json` and fix any TypeScript errors.

---

## Key rules

- `getRequestEvent` and `query`/`form`/`command` all come from `$app/server` — NOT `@sveltejs/kit`
- `redirect`, `error`, `invalid` come from `@sveltejs/kit`
- Route params in components: `page.params.xxx!` (non-null assertion, no `$` prefix)
- Form field issues: `form.fields.fieldName?.issues()?.[0]?.message` (double optional chain)
- For forms that need route context (namespace slug etc.), add a `<input type="hidden" name="namespaceSlug" value={page.params.namespace!} />` inside the form and include that field in the `data` type
- The existing `src/lib/remote/*.remote.ts` plain async functions are server-side helpers — import them from within your new remote functions, do NOT convert them
- `svelte.config.js` must have `kit.experimental.remoteFunctions: true` and `compilerOptions.experimental.async: true` (already set in this project)
