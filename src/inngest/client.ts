import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'scriora-worker',
  name: 'Scriora Background Worker',
  eventKey: process.env.INNGEST_EVENT_KEY ?? 'dev-local-key',
});
