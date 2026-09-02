#!/usr/bin/env bash
#
# apply-forecourt-archives.sh
#
# Applies the outstanding RixDrive patch archives to the repository, in order,
# on top of the base commit they were all cut against.
#
#   1  forecourt-2026-08-10.tar.gz   token generator + drift gate, VAT citations,
#                                    M16 Auto Trader corrections, DECISIONS.md fold-in
#   2  forecourt-2026-08-12.tar.gz   GRANT USAGE ON SCHEMA public, site-page registry,
#                                    link-integrity gate
#   3  forecourt-2026-08-15.tar.gz   audit check 17, two crawler bugs
#   4  forecourt-2026-08-16.tar.gz   admin MFA enrolment + challenge, migration 0023
#   5  forecourt-2026-08-17.tar.gz   M20 finished, migration 0024, three defects
#   6  forecourt-2026-08-18.tar.gz   own_records enforced at last — see docs/18 §6
#
# Usage:
#   ./apply-forecourt-archives.sh --trial   /path/to/archives   # rehearse, change nothing
#   ./apply-forecourt-archives.sh           /path/to/archives   # apply for real
#
# Run it from inside the forecourt working tree. --trial does the whole thing on a
# throwaway branch and deletes it afterwards, so it answers "will this be clean?"
# without touching your branch.
#
# If git am stops on a conflict the script prints what to do and exits. Fix it,
# run `git am --continue`, then run this script again — it resumes where it stopped.

set -uo pipefail

BASE_COMMIT="${FORECOURT_BASE:-1f6f88cc3ff09d5f3d6166f91771a8f926b78c0b}"
WORK_BRANCH="forecourt-archives"
TRIAL_BRANCH="forecourt-archives-trial"
STATE_DIR=".git/forecourt-apply"

ARCHIVES=(
  "forecourt-2026-08-10.tar.gz"
  "forecourt-2026-08-12.tar.gz"
  "forecourt-2026-08-15.tar.gz"
  "forecourt-2026-08-16.tar.gz"
  "forecourt-2026-08-17.tar.gz"
  "forecourt-2026-08-18.tar.gz"
)

# Everything below counts from the array rather than from a literal, because the
# queue has grown once and will grow again for as long as it is not applied.
COUNT="${#ARCHIVES[@]}"

TRIAL=0
SRC=""

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
warn()  { printf '\033[33m%s\033[0m\n' "$*"; }
err()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
ok()    { printf '\033[32m%s\033[0m\n' "$*"; }

die() { err "$*"; exit 1; }

# The subject line of a format-patch file, with the [PATCH n/m] prefix removed and
# folded continuation lines joined. git am preserves this as the commit subject, so
# it survives a conflict resolution — which a patch-id would not.
patch_subject() {
  awk '
    /^Subject: / {
      sub(/^Subject: /, ""); s = $0
      while ((getline line) > 0) {
        if (line ~ /^[ \t]/) { sub(/^[ \t]+/, " ", line); s = s line } else break
      }
      sub(/^\[[^]]*\][ ]*/, "", s)
      print s; exit
    }' "$1"
}

# True when every patch in the list already has a commit with that subject in history.
# This is how the script survives being re-run after `git am --continue`: the archive
# finished by hand, so its progress line was never written, and re-applying it would
# hand the same conflict back a second time.
archive_already_in_history() {
  local subjects s p
  subjects="$(git log --format=%s "$BASE_COMMIT..HEAD" 2>/dev/null)" || return 1
  [ -n "$subjects" ] || return 1
  for p in "$@"; do
    s="$(patch_subject "$p")"
    [ -n "$s" ] || return 1
    printf '%s\n' "$subjects" | grep -qxF "$s" || return 1
  done
  return 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --trial) TRIAL=1; shift ;;
    -h|--help) sed -n '2,31p' "$0"; exit 0 ;;
    *) SRC="$1"; shift ;;
  esac
done

[ -n "$SRC" ] || die "Usage: $0 [--trial] /path/to/directory/containing/the/tar.gz files"
[ -d "$SRC" ] || die "Not a directory: $SRC"
SRC="$(cd "$SRC" && pwd)"

git rev-parse --git-dir >/dev/null 2>&1 || die "Not inside a git repository. cd into the forecourt checkout first."
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || die "Cannot cd to $REPO_ROOT"

# ---------------------------------------------------------------- preflight

bold "Preflight"

if [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
  err "A 'git am' is already in progress."
  err "Finish it first:  git am --continue    (or: git am --abort)"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  err "The working tree is dirty. Commit or stash first — git am refuses to run otherwise."
  git status --short | head -20
  exit 1
fi

MISSING=0
for a in "${ARCHIVES[@]}"; do
  if [ -f "$SRC/$a" ]; then
    printf '  found  %s\n' "$a"
  else
    err "  MISSING $a"
    MISSING=1
  fi
done
[ "$MISSING" -eq 0 ] || die "All $COUNT archives must be present. Order matters and none supersedes another."

if git cat-file -e "$BASE_COMMIT^{commit}" 2>/dev/null; then
  ok "  base commit $BASE_COMMIT is present"
else
  die "Base commit $BASE_COMMIT is not in this repository. Wrong checkout, or fetch first."
fi

START_POINT="$(git rev-parse HEAD)"

# ---------------------------------------------------------------- branch

if [ "$TRIAL" -eq 1 ]; then
  BRANCH="$TRIAL_BRANCH"
  bold "Trial run — working on throwaway branch '$BRANCH', which is deleted at the end."
  git branch -D "$BRANCH" >/dev/null 2>&1
  git checkout -q -b "$BRANCH" || die "Could not create $BRANCH"
else
  BRANCH="$WORK_BRANCH"
  CURRENT="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$CURRENT" != "$BRANCH" ]; then
    if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
      bold "Resuming on existing branch '$BRANCH'"
      git checkout -q "$BRANCH" || die "Could not check out $BRANCH"
    else
      bold "Creating branch '$BRANCH' from $CURRENT"
      git checkout -q -b "$BRANCH" || die "Could not create $BRANCH"
    fi
  else
    bold "Already on '$BRANCH'"
  fi
fi

mkdir -p "$STATE_DIR"
PROGRESS="$STATE_DIR/progress"
[ "$TRIAL" -eq 1 ] && PROGRESS="$STATE_DIR/progress.trial"
touch "$PROGRESS"

# Only meaningful on a fresh start. Mid-run, HEAD is deliberately ahead of the base.
if [ ! -s "$PROGRESS" ] && [ "$START_POINT" != "$BASE_COMMIT" ]; then
  warn "  HEAD is $START_POINT, not the base commit the archives were cut on."
  warn "  The patches will be applied on top of HEAD with a 3-way merge. That is usually"
  warn "  fine, but run with --trial first."
fi

cleanup_trial() {
  if [ "$TRIAL" -eq 1 ]; then
    git am --abort >/dev/null 2>&1
    git checkout -q --force - >/dev/null 2>&1 || git checkout -q --force "$START_POINT" >/dev/null 2>&1
    git branch -D "$TRIAL_BRANCH" >/dev/null 2>&1
    rm -f "$PROGRESS"
    echo
    bold "Trial branch removed. Your working tree is back where it was."
  fi
}
trap cleanup_trial EXIT

# ---------------------------------------------------------------- apply

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; cleanup_trial' EXIT

APPLIED=0
for i in "${!ARCHIVES[@]}"; do
  n=$((i + 1))
  a="${ARCHIVES[$i]}"

  if grep -qxF "$a" "$PROGRESS"; then
    ok "[$n/$COUNT] $a — already applied, skipping"
    continue
  fi

  d="$TMP/$n"
  mkdir -p "$d"
  tar -xzf "$SRC/$a" -C "$d" || die "Could not extract $a"

  # format-patch series: NNNN-subject.patch, anywhere inside the tarball.
  mapfile -t PATCHES < <(find "$d" -type f -name '*.patch' | sort)
  if [ "${#PATCHES[@]}" -eq 0 ]; then
    mapfile -t PATCHES < <(find "$d" -type f -name '*.diff' | sort)
  fi
  [ "${#PATCHES[@]}" -gt 0 ] || die "No .patch files found inside $a"

  if archive_already_in_history "${PATCHES[@]}"; then
    echo "$a" >> "$PROGRESS"
    ok "[$n/$COUNT] $a — every commit is already in history (finished by hand), skipping"
    continue
  fi

  echo
  bold "[$n/$COUNT] $a"
  printf '  %d patch(es)\n' "${#PATCHES[@]}"
  for p in "${PATCHES[@]}"; do
    printf '    %s\n' "$(basename "$p")"
  done

  if git am --3way --whitespace=nowarn "${PATCHES[@]}"; then
    echo "$a" >> "$PROGRESS"
    APPLIED=$((APPLIED + 1))
    ok "  applied cleanly"
  else
    echo
    err "  git am stopped inside $a."
    echo
    CONFLICTS="$(git diff --name-only --diff-filter=U)"
    if [ -n "$CONFLICTS" ]; then
      warn "  Conflicting files:"
      printf '    %s\n' $CONFLICTS
      echo
    fi
    if printf '%s\n' "$CONFLICTS" | grep -q 'packages/domain/src/index.ts'; then
      bold "  This is the ONE conflict that was predicted."
      echo   "  packages/domain/src/index.ts is a barrel of 'export * from' lines. Several"
      echo   "  archives each add one (provenance.js, totp.js, audit-diff.js)."
      echo   "  Resolution: KEEP EVERY export line from BOTH sides. Delete only the"
      echo   "  <<<<<<< ======= >>>>>>> markers. Nothing else in the file matters."
      echo
    fi
    echo "  Then, in this order:"
    echo "      git add -A"
    echo "      git am --continue      # repeat if a later patch in the same archive stops too"
    echo "      $0 ${SRC}"
    echo
    echo "  The re-run will NOT redo archive $n — it checks history by commit subject, so"
    echo "  an archive you finished by hand is recognised and skipped."
    echo
    echo "  To back out entirely:  git am --abort && git checkout main"
    exit 2
  fi
done

# ---------------------------------------------------------------- report

echo
if [ "$TRIAL" -eq 1 ]; then
  bold "TRIAL PASSED — all $COUNT archives apply cleanly."
  echo "Run again without --trial to apply them for real."
  exit 0
fi

ok "All $COUNT archives applied. Branch: $BRANCH"
echo
git --no-pager log --oneline "$BASE_COMMIT..HEAD" | sed 's/^/  /'
echo
bold "Now verify before pushing"
cat <<'EOF'
  pnpm install
  pnpm db:setup --reset          # DESTROYS local data; archive 2 makes this work again
  pnpm db:policies               # expect: 99 tables protected
  pnpm db:seed && pnpm db:seed:crm && pnpm db:seed:leads && pnpm db:seed:prep \
    && pnpm db:seed:deals && pnpm db:seed:channels && pnpm db:seed:admin
  pnpm test                      # expect: ~1,731  (1,723 + archive 6's 8 new tests)
  pnpm test:isolation            # expect: 308. It FAILS loudly if it cannot run.
  pnpm typecheck && pnpm lint && pnpm build

Then:
  git checkout main && git merge --ff-only forecourt-archives && git push
EOF
echo
warn "If you rebuilt the database BEFORE applying archive 2, the isolation suite fails"
warn "238 of 292 with 'function set_tenant_context(...) does not exist'. That is the"
warn "missing schema grant, not a broken migration. After archive 2 it cannot recur."
