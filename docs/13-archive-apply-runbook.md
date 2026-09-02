# Archive apply runbook

**Status:** ready to run · **Owner:** Abdullah · **Written:** 17 Aug 2026 · **Updated:** 19 Aug 2026
**Purpose:** turn "Needs Abdullah #1" from an afternoon into ten minutes.

> Numbered 13 here because the repository's `docs/` only runs to 12. In the project it is
> `docs/18-archive-apply-runbook.md`. Same document.

**Six** patch archives are outstanding, the oldest nine days old. They are the top risk on the
programme — not because the work is at risk of loss while the archives exist, but because no
session can see or build on it, `DECISIONS.md` cannot be folded in, and every new run has to
design around a conflict surface it cannot test.

---

## What you need

The six `.tar.gz` files, in one directory. They were delivered on the days they were cut:

| Order | File | What is inside it |
|---|---|---|
| 1 | `forecourt-2026-08-10.tar.gz` | Rebuilt token generator + drift gate, VAT citation sweep, M16's three Auto Trader corrections, provenance attribution, **the `DECISIONS.md` fold-in** |
| 2 | `forecourt-2026-08-12.tar.gz` | **`GRANT USAGE ON SCHEMA public`** — without it a database rebuilt from scratch is unusable — plus the site-page registry and the link-integrity gate |
| 3 | `forecourt-2026-08-15.tar.gz` | Audit check 17 (dead compliance links), two crawler bugs |
| 4 | `forecourt-2026-08-16.tar.gz` | Admin MFA enrolment and challenge — **without it nobody can sign in to the admin app at all** — migration 0023, the shared TOTP verifier, the vitest subpath alias fix |
| 5 | `forecourt-2026-08-17.tar.gz` | M20 finished: tenant detail, impersonation request/approval, billing actions, migration 0024, three defects |
| 6 | `forecourt-2026-08-18.tar.gz` | **`own_records` enforced at last.** The scope was enforced nowhere in the running product |

**Order matters and none supersedes another.** Earlier archives were rebuilt when they went stale;
these six were not, because a session cannot rebuild work it does not hold.

All six are `git format-patch` series cut on `1f6f88cc3ff09d5f3d6166f91771a8f926b78c0b`, which is
still `main`.

---

## Run it

```bash
cd /d/Projects/dealer/forecourt        # Git Bash. In PowerShell: cd D:\Projects\dealer\forecourt
git checkout main && git pull

# 1. Rehearse. Changes nothing — does the whole thing on a throwaway branch and deletes it.
./docs/apply-forecourt-archives.sh --trial /c/Users/<you>/Downloads/forecourt-archives

# 2. Apply for real. Creates a branch called forecourt-archives.
./docs/apply-forecourt-archives.sh /c/Users/<you>/Downloads/forecourt-archives
```

On Windows run it from **Git Bash or WSL**, not PowerShell. It needs `git`, `tar` and `bash` and
nothing else.

The script refuses to start on a dirty working tree, refuses if any archive is missing, refuses if
a `git am` is already in progress, and checks the base commit is present before it touches anything.

---

## The one conflict, and how to resolve it

`packages/domain/src/index.ts` is a barrel of `export * from` lines. Archives 1, 4 and 5 each add
one — `provenance.js`, `totp.js`, `audit-diff.js` — at the same place in the file, just after the
`platform.js` export. Git cannot know that all three should survive.

**Resolution: keep every export line from both sides.** Delete only the `<<<<<<<`, `=======` and
`>>>>>>>` markers. Nothing else in that file matters and the order of the exports does not matter.

Archive 6 does not touch the barrel.

Then:

```bash
git add -A
git am --continue
./docs/apply-forecourt-archives.sh /path/to/archives   # resumes
```

The re-run will **not** redo the archive you just finished by hand. It checks history by commit
subject rather than by a progress file.

To back out entirely at any point: `git am --abort && git checkout main`. The `forecourt-archives`
branch is the only thing that changes; `main` is untouched until you merge.

---

## Verify before pushing

```bash
pnpm install
pnpm db:setup --reset          # DESTROYS local data
pnpm db:policies               # expect: 99 tables protected
pnpm db:seed && pnpm db:seed:crm && pnpm db:seed:leads && pnpm db:seed:prep \
  && pnpm db:seed:deals && pnpm db:seed:channels && pnpm db:seed:admin
pnpm test                      # expect: ~1,731
pnpm test:isolation            # expect: 308. It FAILS loudly if it cannot run.
pnpm typecheck && pnpm lint && pnpm build
pnpm dev:admin                 # :3003 — sign in, which was impossible before archive 4
```

The `~1,731` is inferred, not measured: no session has ever held all six archives at once. What is
verified is archive 6's own baseline — **1,665 tests green across 48 files including 308
isolation**, on `main` plus archive 6 alone, measured on 18 August against real Postgres 16 rebuilt
from migration 0001. If the number comes out slightly different, count the discrepancy rather than
assuming a failure; a *failure* will name itself.

Then:

```bash
git checkout main && git merge --ff-only forecourt-archives && git push
```

**If you rebuilt the database before applying archive 2**, `pnpm test:isolation` fails 238 of 292
with `function set_tenant_context(...) does not exist`. That is the missing schema grant, not a
broken migration — a role without `USAGE` is told the object does not exist rather than being told
permission is denied. To unstick a database built from `main` without it:

```sql
GRANT USAGE ON SCHEMA public TO app_user, app_public, app_platform, app_migrator;
```

---

## If the archives are gone

They were delivered as file cards in the conversation on 10, 12, 15, 16, 17 and 18 August. If they
are not in Downloads, check those messages — a file card can be re-downloaded. **If they cannot be
recovered, that work is unrecoverable**: the sessions that produced them are gone, and a session
cannot rebuild work it does not hold. In that case say so and the affected slices get rebuilt from
their descriptions in `STATE.md` and `DECISIONS-pending.md`, which are detailed enough to make that
a rebuild rather than a rediscovery — but it is days of work, not minutes.

The one item worth rebuilding immediately in that case is archive 2's one-line schema grant, which
is quoted above.
