<!-- The base is phase1: main moves only at a release. CONTRIBUTING.md has the rules. -->

## What changed

What was wrong, and what this change does, in plain words.

## How it was checked

- The failing test, committed first (its "Red" commit), and how it failed:
- Tests and results after the fix (unit, end-to-end):
- Mac:
- Windows (or the CI result still needed):

## CHANGELOG line for the owner

One line, in plain words for operators (or "none"):

## Checklist

- [ ] The branch is made from `phase1`, and this pull request's base is `phase1`.
- [ ] Tests: the failing test first, then the fix; `pnpm typecheck`, `pnpm lint` and the changed feature's tests pass.
- [ ] No check weakened: no raised time limit or budget, no skip, no retry, no longer timeout.
- [ ] Docs: the guides, the Manual, `docs/api.md` and README say what changed, where they should, and the word
      tests pass.
- [ ] No `Co-Authored-By` line in any commit.
- [ ] No secrets in the change, its commits or its logs: no stream key, password, token, PIN, pairing code,
      certificate or Gmail address, and no `.env` file or `.mcp.json`.
- [ ] Placeholder words and generated media only: no real names, places, kirtan, scripture or mandir content.
- [ ] Nothing paid, and no new dependency or download without the owner's yes.
