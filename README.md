# scriora-worker

Durable background job executor for Scriora  -  powered by Inngest.

**Mandate:** Execute long-running operations reliably with
retry, idempotency, and cancellation support.

**Jobs (Phase 1):**
- publish.job  -  Execute scheduled publication to social platform
- verify.job  -  Verify post is live after publish attempt
- retry.job  -  Handle retryable failures with backoff
- media.job  -  Dispatch media processing pipeline
- analytics.job  -  Ingest platform engagement metrics
- outbox.job  -  Consume outbox_commands table
- cleanup.job  -  Lifecycle and expiry management

**Invariants:**
- No domain ownership  -  delegates to scriora-core contracts
- Every job is idempotent (safe to run twice)
- Every failure classified: RETRYABLE / TERMINAL / RECONCILIATION
- Dead Letter Queue for exhausted retries

Reference: scriora-docs/architecture/SCRIORA_REPOSITORY_SPECIFICATIONS.md

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start with hot-reload |
| `pnpm build` | Compile TypeScript |
| `pnpm test` | Run job unit + integration tests |
| `pnpm typecheck` | Type-check without emitting |

## Quality Gate

```bash
pnpm typecheck && pnpm test && pnpm build
```

Coverage minimum: 85%