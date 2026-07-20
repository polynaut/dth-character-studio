---
name: dep-release
description: Put already-merged dependency bumps on the release train. Dependabot PRs carry no changesets, so product-relevant bumps (Rust crates, runtime npm deps) never release themselves — use this after merging dep PRs to cut the patch release, or to confirm none is needed.
---

Goal: every **product-relevant** dependency bump merged on main but not yet
released goes out in a patch release. Dependabot PRs are exempt from the
changeset gate, so nothing bumps the version until someone adds a changeset —
that someone is this skill.

## Steps

1. **Establish the window.** Last released tag:
   `gh release view --json tagName -q .tagName`. Then list dependency merges
   since: `git log <tag>..origin/main --oneline -E --grep 'bump'`
   (Dependabot squash-merges are titled `chore(deps): bump …` / `ci: bump …`).
   Nothing found → report "nothing unreleased" and stop.

2. **Classify each bump** (check the PR diff when unsure):
   - **Product-relevant** → ships in the app: anything in
     `apps/desktop/Cargo.toml`/`Cargo.lock` (compiled into the binary), and
     packages under `dependencies` (NOT `devDependencies`) of `apps/web`,
     `packages/rom`, `packages/ui`.
   - **Not product-relevant** → no release needed for these alone:
     `devDependencies` (typescript, vitest, `@types/*`, tooling), GitHub
     Actions bumps, and lockfile-only transitive bumps of dev tooling.

3. **No product-relevant bumps** → report that and stop.

4. **Write the changeset** `.changeset/<short-slug>.md`:

   ```markdown
   ---
   '@dth/desktop': patch
   ---

   Dependency refresh: <the product-relevant bumps, human-readable — e.g. "Tauri 2.11.5 and zip 4 in the desktop shell">.
   ```

   The four packages are a fixed group — one `patch` entry bumps the product
   version. Name the package(s) actually affected (`@dth/web` for runtime web
   deps). The summary line is the changelog entry — write it for users.

5. **Ship it.** main is PR-only: branch (`chore/dep-release-<date>`), commit,
   push, open the PR, merge on green CI.

6. **Version PR.** The Version workflow opens/updates the
   `changeset-release/main` PR. If its checks sit at `action_required`,
   approve the run: `gh api -X POST repos/{owner}/{repo}/actions/runs/<id>/approve`.
   Merge it on green — this triggers the Release workflow.

7. **Signing gate.** The Release run pauses on the `release-signing`
   environment. Approve it:
   `gh api repos/{owner}/{repo}/actions/runs/<run>/pending_deployments` (GET →
   environment id), then POST the same endpoint with
   `-F "environment_ids[]=<id>" -f state=approved -f comment="dep release"`.
   The self-hosted signer then signs and publishes.

8. **Verify.** `gh release view` shows the new tag, published, with the
   Windows installer + `.sig`, the macOS `.dmg`, and `latest.json`.
