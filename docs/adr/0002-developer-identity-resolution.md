# ADR-0002 — Developer identity resolution

**Status:** Accepted · **Date:** 2026-08-31 · **Affects:** [01-data-model.md §2.5–2.7](../01-data-model.md), [02-pipeline.md §5.1](../02-pipeline.md)

## Context

Git data identifies people three different ways, and they do not agree:

| Source | Identifier |
|---|---|
| Commit | author **email** and name, from local `git config` |
| Pull request, review, issue | provider **user id** and login |
| Workspace membership | a DevIntel **account** |

One person routinely produces several: a work laptop and a personal laptop with different
`user.email` settings, a `noreply` address from the web editor, an email changed after a
rename. Meanwhile bots (`dependabot[bot]`, CI accounts) look exactly like people in the data.

If `Developer` is a single row keyed by one of these, the model breaks the first time somebody
commits from a second machine: their activity splits across two "people", every per-person
metric halves, and the team's collaboration graph gains a phantom member.

## Options

**A — Key on provider user id.** Correct for PRs, reviews and issues. Loses commits whose email
does not resolve to a provider account — which on real repositories is a substantial fraction,
including every commit authored before the person joined the provider organization.

**B — Key on email.** Correct for commits. Wrong for everything else, since PR and review
payloads do not reliably carry an email at all.

**C — Separate the person from the identifiers they are observed under.**

## Decision

**Option C** — a three-layer model:

```text
User               a platform account (login, session, RBAC)
Developer          a person within one workspace — everything metric-bearing attaches here
DeveloperIdentity  (provider, kind, value) → Developer      [many-to-one]
```

`DeveloperIdentity` is unique on `(workspaceId, provider, kind, value)`, where `kind` is
`PROVIDER_USER` or `EMAIL`. Ingestion resolves every raw actor through it, in order:

1. `(provider, PROVIDER_USER, id)` → `EXACT`
2. `(GIT, EMAIL, email)` → `EXACT`
3. Provider account known but the commit email is new → attach the email to the same developer,
   marked `INFERRED`
4. No match → create an unclaimed `Developer` plus its identity

`User ↔ Developer` is a separate, optional link (`claimedByUserId`): a person appears in the
data long before — or without ever — holding an account.

## Consequences

**Good.** Commits and pull requests by the same person aggregate correctly even when the keys
differ. Contributors who never sign up still appear in repository analytics, which is what makes
team and bus-factor numbers true rather than partial. Bots are flagged once
(`Developer.isBot`) and excluded from every people-facing metric while still counting toward
repository activity — Dependabot keeps a repository's commit graph alive but must never appear
in a review-load chart.

**Cost.** Every ingestion path performs a resolution lookup. Mitigated by an in-memory per-job
cache; identities change rarely and the working set per repository is small.

**Risk — a wrong merge.** Two people sharing a machine, or a shared bot email, can be inferred
into one developer. Mitigated three ways: merges set `mergedIntoId` rather than deleting, so
they are reversible; `confidence` is recorded per identity so `INFERRED` links are reviewable;
and an admin screen lists low-confidence links for confirmation. A merge or split enqueues a
recompute of the affected rollups, which is an ordinary job ([02 §9](../02-pipeline.md)).

**Deliberate limitation.** No fuzzy name matching. "A. Karimi" and "Amir Karimi" are not
automatically the same person. Silently merging two colleagues' contribution histories is a far
worse failure than leaving two rows for one person, and the manual merge path exists precisely
so the machine does not have to guess.
