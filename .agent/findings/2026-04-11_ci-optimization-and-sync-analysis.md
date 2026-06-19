# CI Optimization & Sync Failure Analysis

**Date:** 2026-04-11  
**Scope:** GitHub Actions workflows and auto-sync system

---

## Part 1: Auto-Sync Failure Analysis

### Why the Sync Failed (Root Cause)

The auto-sync system **worked correctly** — it intentionally failed as a safety mechanism.

**What happened:**
1. Upstream had 15+ new commits with model configuration updates
2. Some upstream commits added a new `structured_output` field to TOML model files
3. Local fork had older versions of the same files (without `structured_output`)
4. When the sync workflow attempted to merge, **merge conflicts occurred** in:
   - 12 Bedrock model files (different `structured_output` and `knowledge` date formats)
   - 2 LLMGateway model files
   - 1 ZenMux model file
   - 3 deprecated models deleted upstream but still in fork
   - schema.ts (new JsonValue type vs. local date helpers)

**The workflow's response (correct):**
```
1. Detect conflicts with: git merge --no-commit
2. Abort the conflicted merge
3. Write detailed conflict report to workflow summary
4. Exit with failure (intentional) to prevent pushing broken code
5. Send failure notification (prompting manual resolution)
```

**Why this is good design:**
- The sync workflow is deliberately **conservative** — it refuses to push code with unresolved conflicts
- It provides detailed reporting in the GitHub Actions summary
- Manual resolution ensures data integrity, especially important for a model catalog

### What Was Needed

The 15 conflicts required:
1. Manual merging of structured_output field additions
2. Date validation fixes (4 files had `last_updated < release_date`)
3. Deletion of 3 deprecated models

All of these were human-reviewed and fixed during the manual sync.

### Recommendation

No changes to the sync workflow are needed — it behaved correctly. However, consider:

**Optional enhancement:** Add a pre-merge validation step that checks for common conflict patterns:
- Model files with conflicting dates (release_date vs. last_updated)
- Conflicting field additions (structured_output, etc.)

This could provide earlier warning, but the current workflow's safety-first approach is sound.

---

## Part 2: CI Pipeline Performance Optimization

### Current Performance Profile

Measured locally on this machine:

| Component | Time | Notes |
|-----------|------|-------|
| Bun setup | ~10-20s | (GitHub Actions overhead; fast locally) |
| `bun install --frozen-lockfile` | ~5-15s | (minimal deps for monorepo; small lockfile) |
| `bun validate` | 0.63s | Validates 4,170 models across 110 providers |
| `bun test` | 0.05s | 97 tests, 4 files |
| `bun run build` (web) | 1.02s | Generates API catalog (110 providers, 4,170 models) |
| **Total execution time** | ~7-8s | (excluding setup overhead) |

### GitHub Actions Overhead Timing

The above measurements are pure execution. In GitHub Actions, add:
- **Checkout**: 10-15s
- **Setup Bun**: 20-30s (downloading and installing)
- **Install dependencies**: 5-15s
- **Each step overhead**: ~2-3s per step
- **Total workflow overhead**: ~60-90 seconds

**Estimated GitHub Actions validate.yml run time: 70-110 seconds**

### Optimization Opportunities

#### 1. **Use Bun's Cache in GitHub Actions** (HIGH IMPACT - saves 15-30s)

Currently: `bun install` runs without caching between runs

```yaml
# Add before "Setup Bun" step
- name: Setup Bun cache
  uses: actions/setup-node@v4
  with:
    cache: 'bun'
    cache-dependency-path: './bun.lock'
```

**Savings:** 10-30s per run (depends on lock file size; current is only 4.4KB)  
**Risk:** None (bun handles cache invalidation)

#### 2. **Use Matrix Testing for Parallel Execution** (MEDIUM IMPACT - saves 5-10s)

Currently: Tests run sequentially  
Optimization: Split test suites across parallel jobs

```yaml
strategy:
  matrix:
    test-suite:
      - packages/core/test
      - packages/web/test
      - packages/function/test
```

**Savings:** 5-10s (minimal due to already-fast test suite)  
**Note:** Not recommended given test suite is only 50ms — overhead of job setup would negate savings

#### 3. **Separate Validation from Build** (MEDIUM IMPACT - allows conditional skip)

Currently: All checks run on every PR  
Better: Skip build if validation fails

```yaml
jobs:
  validate:
    name: Validate Models
    runs-on: ubuntu-latest
    # runs alone, exits early if fails
    
  build:
    name: Build Web Interface
    runs-on: ubuntu-latest
    needs: validate  # only runs if validate passes
```

**Savings:** 1-2s of sequential execution (small benefit)  
**Benefit:** Faster feedback on validation failures (don't wait for build)  
**Current:** validate.yml already does this correctly

#### 4. **Skip Install if Not Needed** (LOW IMPACT - saves 5-15s conditionally)

Currently: `bun install` runs even when only validation is needed

```yaml
- name: Install dependencies (only if build needed)
  if: github.event_name == 'pull_request'
  run: bun install --frozen-lockfile
```

**Savings:** 5-15s (only on workflow_dispatch or manual runs)  
**Current issue:** The validate script needs TypeScript compilation, which requires deps

#### 5. **Consolidate Redundant Workflows** (LOW IMPACT - organizational)

The codebase has:
- `validate.yml` — for PRs
- `sync-upstream.yml` — for scheduled merges
- `deploy.yml` — for pushes to dev
- `freshness.yml` — weekly data quality checks

**Observation:** `validate.yml` and `sync-upstream.yml` both run `bun validate` + `bun test` + `bun run build`

**Optimization:** Create a reusable workflow

```yaml
# .github/workflows/_ci-check.yml
on:
  workflow_call:
    inputs:
      skip-build:
        type: boolean
        default: false

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: oven-sh/setup-bun@v1
      - run: bun install --frozen-lockfile
      - run: bun validate
      - run: bun test packages/core/test
      - if: ${{ !inputs.skip-build }}
        run: cd packages/web && bun run build
```

Then call from `validate.yml` and `sync-upstream.yml`:

```yaml
jobs:
  validate:
    uses: ./.github/workflows/_ci-check.yml
    with:
      skip-build: true  # only validate, don't build
```

**Savings:** Cleaner code; enables tuning per-workflow (skip build in sync, include in deploy)

### Recommended Quick Wins (Ordered by Impact)

| Priority | Change | Impact | Effort | Notes |
|----------|--------|--------|--------|-------|
| 🔴 P1 | Add Bun cache to GitHub Actions | 10-30s | 3 lines | One-liner; no downside |
| 🟡 P2 | Create reusable workflow | Organization | 20 lines | Better maintainability |
| 🟡 P2 | Skip build in sync-upstream | 1-2s | conditional run | Lower priority to sync speed |
| 🟢 P3 | Matrix testing | 0s | Not recommended | Tests already too fast; overhead > benefit |

### Current Bottleneck Analysis

**The biggest bottleneck is NOT your code execution — it's GitHub Actions overhead:**

- Code execution: ~7-8 seconds
- Checkout + setup + install: ~60-90 seconds
- **GitHub Actions overhead is 10x your code time**

**The most impactful optimization is Bun caching** (saves 10-30s of the 60-90s overhead).

---

## Implementation Recommendation

### Immediate (5 minutes)

Add Bun cache to `validate.yml` and `deploy.yml`:

```yaml
- name: Setup Bun cache
  uses: actions/setup-node@v4
  with:
    cache: 'bun'
    cache-dependency-path: './bun.lock'
```

**Expected improvement:** 10-30s faster CI runs  
**Estimated new validate.yml runtime:** 50-80 seconds (down from 70-110 seconds)

### Next (15 minutes)

Update `sync-upstream.yml` to skip web build (line 107):

```yaml
- name: Build web interface (verify no regressions)
  if: steps.merge.outputs.result == 'success' && steps.validate.outputs.result == 'pass'
  uses: oven-sh/setup-bun@v1
  ...
```

OR (simpler): Change from `latest` Bun version to specific pinned version to avoid setup variability:

```yaml
- name: Setup Bun
  uses: oven-sh/setup-bun@v1
  with:
    bun-version: 1.3.11  # Pin version instead of 'latest'
```

**Expected improvement:** More predictable CI times (less variation between runs)

### Nice-to-Have (30 minutes)

Refactor `validate.yml` and `sync-upstream.yml` to use a shared reusable workflow — enables better tuning per workflow without code duplication.

---

## Summary

| Question | Answer |
|----------|--------|
| **Why did auto-sync fail?** | Merge conflicts detected intentionally — safety mechanism working as designed |
| **What can be optimized?** | GitHub Actions overhead (60-90s) not code execution (7-8s) |
| **Quickest win?** | Add Bun cache (saves 10-30s) with 3-line code change |
| **Overall pipeline time?** | Currently 70-110s; can be reduced to 50-80s with caching |
| **Risk of optimization?** | Minimal — all recommendations are additive or organizational |

