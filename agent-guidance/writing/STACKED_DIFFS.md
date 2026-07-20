# Stacked Diffs

Use stacked diffs when one change is too large for a single reviewable PR.

The standard is the GitHub-visible shape of the work, not the local tool used to create it. Humans may use plain Git. Agents should use Graphite CLI when it is available. Both workflows must produce the same branch structure, PR titles, and PR descriptions.

## Required Shape

Each stack slice is a normal branch and a normal GitHub PR.

```txt
main
  -> dividimos/expense-activation-schema
      -> dividimos/expense-activation-rpc
          -> dividimos/expense-activation-ui
              -> dividimos/pix-key-security
```

GitHub PR bases must follow the same order:

```txt
PR 1: dividimos/expense-activation-schema -> main
PR 2: dividimos/expense-activation-rpc   -> dividimos/expense-activation-schema
PR 3: dividimos/expense-activation-ui    -> dividimos/expense-activation-rpc
PR 4: dividimos/pix-key-security         -> dividimos/expense-activation-ui
```

Do not require reviewers to open Graphite. Review happens in GitHub.

## PR Titles

Use a position prefix for every stacked PR:

```txt
[1/4] Add expense activation schema migration
[2/4] Add activate_expense RPC with balance updates
[3/4] Wire expense activation into the wizard UI
[4/4] Harden Pix key encryption and generation
```

## PR Description

Every stacked PR must include a stack section in the PR body:

```md
## Stack

1. #12 [1/4] Add expense activation schema migration
2. #13 [2/4] Add activate_expense RPC with balance updates
3. #14 [3/4] Wire expense activation into the wizard UI
4. #15 [4/4] Harden Pix key encryption and generation

This PR is: 2 of 4.
Review order: #12 -> #13 -> #14 -> #15.

## Scope

This PR adds the `activate_expense` RPC and the atomic `balances` update.

## Depends On

- #12 for the expense activation schema migration.

## Intentionally Left Out

- Wizard UI wiring.
- Pix key hardening.
```

When PR numbers do not exist yet, use branch names. Update the stack section after PRs are opened.

## Agent Workflow

Agents should check for Graphite before creating any stacked branches:

```bash
gt --version
```

If Graphite is available, use Graphite from the first branch onward. Do not create the stack with `git checkout -b` and then switch to Graphite at submit time; Graphite will not know the parent relationship for those plain Git branches until they are manually tracked.

Use plain Git only when Graphite is unavailable, when the human explicitly prefers plain Git, or when Graphite is blocked and the human accepts the fallback.

## Plain Git Workflow

Use this when Graphite is unavailable or the author prefers plain Git:

```bash
git checkout main
git pull
git checkout -b dividimos/expense-activation-schema
```

Open the first PR against `main`.

For each next slice, branch from the previous slice:

```bash
git checkout dividimos/expense-activation-schema
git checkout -b dividimos/expense-activation-rpc
```

Open the next PR against its parent branch, not against `main`.

## Graphite Workflow

Use Graphite CLI as the preferred helper for agent-driven stacks and for humans who want local stack management:

```bash
gt init
gt create dividimos/expense-activation-schema
# make the first focused change and commit it
gt create dividimos/expense-activation-rpc
# make the second focused change and commit it
gt create dividimos/expense-activation-ui
# continue one reviewable branch at a time
gt log --stack
gt submit --cli --edit
```

Graphite helps create, restack, sync, and submit the branches. It does not replace the GitHub PR description. The GitHub-visible stack section is still required.

Use `gt submit --cli --edit` so PR metadata can be written from the terminal instead of the Graphite dashboard.

### Recovering A Plain Git Stack

If branches were already created with plain Git and need to be submitted with Graphite, track each branch with its intended parent before submitting:

```bash
gt track dividimos/expense-activation-schema --parent main
gt track dividimos/expense-activation-rpc --parent dividimos/expense-activation-schema
gt track dividimos/expense-activation-ui --parent dividimos/expense-activation-rpc
```

After tracking, verify the shape:

```bash
gt log --stack
```

Then submit through Graphite:

```bash
gt submit --cli --edit
```

This recovery path is acceptable, but agents should avoid needing it by using `gt create` from the start when Graphite is available.

## Review Rules

- Keep each PR under 1,000 changed lines, excluding generated code.
- Keep each PR focused on one reviewable step.
- Multiple commits per PR are fine while developing.
- Each PR must be understandable in isolation and reviewable in order.
- CI must pass for the PR being merged.
- Merge from the bottom of the stack upward.
- Human review is required for every PR.

## Agent Rules

- Check `gt --version` before creating stacked branches.
- If `gt` is available, use Graphite CLI for stack management from the first branch onward.
- Use `gt create` for new stack branches; do not use `git checkout -b` and expect Graphite to infer the stack later.
- If `gt` is unavailable, use plain Git and preserve the same GitHub-visible structure.
- Always include the stack order in PR descriptions.
- Do not depend on the Graphite dashboard for reviewer context.
- Do not push to `main`.
- Do not merge PRs unless a human explicitly asks.
