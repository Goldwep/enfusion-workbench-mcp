# Git hooks

The `pre-push` hook guards the 2.0 work (plan section 5.2); `pre-commit` is a no-op since
DEC-060. Both are POSIX `sh` scripts, so they run
under Git Bash on Windows as well as on Linux and macOS.

| Hook         | What it does                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-push`   | Allows only the local `public-release` branch, pushed as a fast-forward to the remote branch it tracks (`branch.public-release.merge`: `refs/heads/main` on the owner's machine; the same-named branch when unset). Rejects every other branch, every tag, every remote-ref deletion, any commit sharing history with local `main` or `v2`, and any non-fast-forward push, naming the ref and the reason. |
| `pre-commit` | A no-op that exits 0. It ran the PII gate until DEC-060 removed the gate; the file stays so installed hook paths do not break.                                                                                                                                                                                                                                                                            |

**This cloud branch does not install them.** Nothing here runs `git config` or copies files into
`.git/hooks`. Installing is an owner step on the owner's machine.

## Installing on the owner's machine

`<repo>` is the main checkout (branch `main`, used by the maintenance session); `<v2>` is the
2.0 worktree (branch `v2`).

1. Shared hooks path, set once in the main checkout. Git hooks are per repository, not per
   branch, so this protects the maintenance checkout too: the pre-push hook then guards every
   push from `<repo>` and from any worktree without its own setting.

   ```sh
   cd <repo>
   git config core.hooksPath .githooks
   ```

   The relative path resolves against the root of whichever worktree runs the hook, so each
   worktree needs a `.githooks` directory. Until `main` carries one, copy `pre-push` into
   `<repo>/.githooks/`. The maintenance session is told the hook exists.

2. Per-worktree hooks path in the v2 worktree (the repository already has
   `extensions.worktreeConfig` enabled):

   ```sh
   cd <v2>
   git config --worktree core.hooksPath <v2>/.githooks
   ```

   `<v2>/.githooks` carries both `pre-commit` and a copy of `pre-push`.

3. Check the result: `git config --show-origin --get-all core.hooksPath` in each checkout.

On Windows the executable bit is not tracked by the file system; Git Bash runs the hooks by
their `#!/bin/sh` line. If a hook is ever reported as not executable, run
`git update-index --chmod=+x .githooks/pre-push .githooks/pre-commit` and commit.

## Testing without touching `origin`

Never test a hook by pushing to `origin`.

Feed ref lines on standard input. Each line is
`<local ref> <local sha> <remote ref> <remote sha>`; a sha of all zeros means "does not exist".

```sh
z=0000000000000000000000000000000000000000
s=$(git rev-parse HEAD)
# rejected: exit 1, message names refs/heads/v2
printf 'refs/heads/v2 %s refs/heads/v2 %s\n' "$s" "$z" | sh .githooks/pre-push origin test
# rejected: tag
printf 'refs/tags/v2.0.0 %s refs/tags/v2.0.0 %s\n' "$s" "$z" | sh .githooks/pre-push origin test
# rejected: deletion
printf '(delete) %s refs/heads/public-release %s\n' "$z" "$s" | sh .githooks/pre-push origin test
# allowed: exit 0 (a new remote public-release)
printf 'refs/heads/public-release %s refs/heads/public-release %s\n' "$s" "$z" | sh .githooks/pre-push origin test
```

Or push to a local bare repository in a scratch directory, which runs the installed hook for
real:

```sh
git init --bare <sandbox>/hook-test.git
git push <sandbox>/hook-test.git v2                # rejected by pre-push
git push <sandbox>/hook-test.git public-release    # allowed
```

The automated version of the standard-input test is `tests/scripts/githooks.test.ts`.
