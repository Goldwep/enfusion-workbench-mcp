# Git hooks

Two hooks guard the 2.0 work (plan section 5.2). Both are POSIX `sh` scripts, so they run
under Git Bash on Windows as well as on Linux and macOS.

| Hook         | What it does                                                                                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-push`   | Allows only `refs/heads/public-release`, pushed from the local `public-release` branch, as a fast-forward. Rejects every other branch, every tag, every remote-ref deletion and any non-fast-forward push, naming the ref and the reason. |
| `pre-commit` | Runs `npx --no tsx scripts/pii-gate.ts --staged` and blocks the commit when the PII gate exits 1 (findings) or 2 (configuration error, for example a missing owner pattern file). Prints the gate's output.                               |

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

2. Per-worktree hooks path in the v2 worktree, so the PII pre-commit hook applies to `v2` only
   (the repository already has `extensions.worktreeConfig` enabled):

   ```sh
   cd <v2>
   git config --worktree core.hooksPath <v2>/.githooks
   ```

   `<v2>/.githooks` carries both `pre-commit` and a copy of `pre-push`.

3. Create the owner pattern file the PII gate reads (plan OA-9), outside the repository:
   `%LOCALAPPDATA%\enfusion-mcp\pii-patterns.txt`. One literal or `re:` regular expression per
   line; `#` starts a comment. Without it the pre-commit hook blocks every commit.

4. Check the result: `git config --show-origin --get-all core.hooksPath` in each checkout.

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

The pre-commit hook can be exercised the same way: stage a file that contains a planted path
in a scratch clone and run `sh .githooks/pre-commit`.
