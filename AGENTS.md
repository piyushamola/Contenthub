# Change and regression test rules

These instructions apply to all work in this repository. Tests are part of a feature or bug fix and must be included in the same change.

## Test execution is opt-in

Do not start tests or verification commands unless the user explicitly asks for testing in the current request. A request to build, change, or fix code does not itself authorize running tests. This includes focused tests, full suites, integration or HTTP tests, browser or stack tests, typechecks, lint, builds, and payment tests. You may inspect and add or update test code without running it. Previous requests to test do not carry over to later changes.

When the user asks for testing, run only the checks needed for the requested scope and report the exact results. If testing was not requested, state that it was not run; do not delay completion to obtain a passing check.

## Before changing code

- Read [the regression guide](docs/regression-testing.md) and inspect the tests for the affected behavior.
- Identify which existing API consumers, services, permissions, and stored records could be affected.
- Use Node 22 from `.nvmrc`. Preserve unrelated local changes.

## Required coverage

- **New or changed behavior:** add or update tests for the intended result, important invalid input, and relevant failure or permission cases. Use the smallest test layer that proves the behavior.
- **Bug fixes:** add a regression test that would reproduce the bug. Run it before and after the fix only when the user explicitly asks for testing.
- **Routes and permissions:** cover allowed access and the relevant anonymous, wrong-owner, or insufficient-permission cases. Use real HTTP integration tests when routing, JWT handling, policies, or response shape matters.
- **Schemas, database operations, and migrations:** use the real Strapi integration suite to check persisted state, relationships, and publication behavior. For migrations, cover existing records and repeated execution when applicable. Unit mocks alone do not prove database behavior.
- **Payments and lifecycle changes:** cover relevant amount/currency checks, duplicate requests, retries, expiry boundaries, and failure recovery. Stub provider calls and assert the resulting state.
- **Shared API or schema changes:** update backend contract tests together with frontend tests and CMS fixtures in `../birthday-celebration`.
- **Refactors:** existing behavior tests may be sufficient if they exercise the changed path. Add coverage for gaps and explain which tests protect the refactor.
- **Documentation or other low-impact changes:** do not add artificial tests that merely mirror the edit. State why automated coverage is unchanged and perform the relevant document or configuration check.

## Where tests belong

| Behavior | Test location |
| --- | --- |
| Service, policy, validation, and payment rules | `tests/*.test.js` |
| Real Strapi/database lifecycle and migrations | `scripts/test-birthday-story.cjs`, or a new suite wired into `scripts/run-check.cjs` |
| Real HTTP authentication, permissions, and response contracts | `tests/helpers/http-regression.cjs` |
| Disposable browser-test server and cleanup | `scripts/test-regression-server.cjs` |
| Browser → Next → real Contenthub journeys | `../birthday-celebration/tests/stack/*.spec.ts` |

New test files must be wired into `npm run check` so they can run when requested. The runner discovers `tests/*.test.js` automatically; new integration suites must be wired into `scripts/run-check.cjs`.

## Test quality and isolation

- Assert observable responses, permissions, and persisted state. Avoid assertions about source text or private implementation details.
- Extend the existing Node test runner and Strapi integration suites. Do not introduce another test framework without a concrete need. Do not leave focused tests such as `test.only` in the change.
- When testing is requested, run through the npm scripts and `scripts/run-check.cjs`, which provide disposable SQLite, uploads, configuration, and dummy credentials.
- Keep tests independent and deterministic. Keep the network guards enabled and stub external providers at their boundary.
- Never point regression tests at a development or production database, use live payment credentials, or send real email.
- Do not skip, delete, weaken, or add retries to a failing test just to make CI pass. For an intentional behavior change, update the documented expectation and its tests together.
- SQLite checks do not prove PostgreSQL-specific SQL or locking. Identify when a change also needs a disposable PostgreSQL or staging check, and report that verification accurately.

## Before marking implementation complete

1. Add or update relevant test coverage, but do not execute it without the user's explicit request.
2. If the user requests testing, choose focused checks first and broader gates only when the requested scope warrants them. `npm run check` covers this repository; frontend `npm run check` and `npm run test:stack` cover shared API and cross-app changes. Razorpay sandbox calls require a separate explicit request.
3. Record tests added or updated, any commands actually run, results, and remaining manual checks in the handoff or PR.
4. If checks were not requested, say so plainly. Never describe unrun checks as passing or the change as verified.

These instructions guide future changes; GitHub branch rules must require **Backend regression** to block merges when checks fail. See the regression guide for setup and known coverage gaps.
