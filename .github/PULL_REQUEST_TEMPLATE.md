## Summary
<!-- Briefly describe what this pull request implements or fixes -->

## Semver Release Impact
<!-- Pushing/merging to `main` automatically triggers the Semantic Release pipeline based on Conventional Commits or PR labels -->
- [ ] **Patch (`vX.Y.Z+1`)**: Bug fix, performance tweak, or internal refactor (`fix:`, `perf:`, `refactor:`, or label `semver:patch`)
- [ ] **Minor (`vX.Y+1.0`)**: New backward-compatible feature, tool, resource, or prompt (`feat:`, or label `semver:minor`)
- [ ] **Major (`vX+1.0.0`)**: Breaking API or schema change (`feat!:`, `BREAKING CHANGE:`, or label `semver:major`)
- [ ] **No Release (`none`)**: Documentation, tests, or CI maintenance only (`docs:`, `test:`, `ci:`, `chore:`, or label `semver:skip`)

## Verification Checklist
- [ ] Developed on a dedicated feature/fix branch (`feat/...`, `fix/...`, `chore/...`)
- [ ] `npm run typecheck` passes with 0 errors
- [ ] `npm run build` compiles cleanly
- [ ] `npm test` passes all unit & integration suites with >90% coverage enforced by `c8`
- [ ] `npm run release:check` confirms expected semantic version bump
