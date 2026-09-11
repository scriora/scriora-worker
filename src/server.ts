// scriora-worker — Durable Job Executor (Inngest)
// Mandate: Execute scheduled publications, retries, media jobs,
//          analytics ingestion, and outbox consumption.
// INVARIANT: No domain ownership — delegates to scriora-core contracts
// Reference: scriora-docs/architecture/SCRIORA_REPOSITORY_SPECIFICATIONS.md

import { serve } from 'inngest/node';
import { inngest } from './inngest.js';

// Jobs will be registered here in Phase 1
// Reference: scriora-docs/architecture/SCRIORA_STATE_AND_ERROR_MODEL.md
const functions: [] = [];

const handler = serve({
  client: inngest,
  functions,
});

export default handler;
