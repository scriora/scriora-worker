import type { PrismaClient } from 'scriora-core';
import { platformRegistry, type SocialPlatformType } from 'scriora-social';

export interface DispatchResult {
  success: boolean;
  externalPostId?: string | undefined;
  externalPostUrl?: string | undefined;
  error?: string | undefined;
}

export async function processOutboxCommand(
  db: PrismaClient,
  outboxCommandId: string
): Promise<DispatchResult> {
  // 1. Fetch outbox command with relations
  const command = await db.outboxCommand.findUnique({
    where: { id: outboxCommandId },
    include: {
      publication: true,
      publishAttempt: true,
    },
  });

  if (!command) {
    throw new Error(`OUTBOX_COMMAND_NOT_FOUND: ${outboxCommandId}`);
  }

  if (command.status === 'PUBLISHED') {
    return { success: true, externalPostId: command.publication.externalPostId ?? undefined };
  }

  // Mark command as claimed / processing
  await db.outboxCommand.update({
    where: { id: outboxCommandId },
    data: {
      status: 'PROCESSING',
      claimedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  const payload = command.payload as Record<string, unknown>;
  const platform = payload.platform as SocialPlatformType;

  // 2. Resolve platform adapter from scriora-social
  const adapter = platformRegistry.get(platform);

  try {
    // 3. Dispatch to platform
    const result = await adapter.publish({
      workspaceId: command.workspaceId,
      accountId: payload.socialAccountId as string,
      text: (payload.body as string) ?? '',
      mediaUrls: [],
      idempotencyKey: payload.idempotencyKey as string,
      fingerprint: payload.fingerprint as string,
      metadata: {},
    });

    if (result.status === 'SUCCEEDED' && result.externalPostId) {
      // 4. Update database records inside transaction
      await db.$transaction(async (tx) => {
        await tx.publishAttempt.update({
          where: { id: command.publishAttemptId },
          data: {
            status: 'SUCCEEDED',
            externalId: result.externalPostId ?? null,
            externalUrl: result.externalPostUrl ?? null,
            completedAt: new Date(),
          },
        });

        await tx.publication.update({
          where: { id: command.publicationId },
          data: {
            status: 'PUBLISHED',
            externalPostId: result.externalPostId ?? null,
            externalPostUrl: result.externalPostUrl ?? null,
            publishedAt: new Date(),
          },
        });

        await tx.outboxCommand.update({
          where: { id: outboxCommandId },
          data: {
            status: 'PUBLISHED',
            processedAt: new Date(),
          },
        });
      });

      return {
        success: true,
        externalPostId: result.externalPostId,
        externalPostUrl: result.externalPostUrl,
      };
    }

    // Platform returned failure or pending
    await db.publishAttempt.update({
      where: { id: command.publishAttemptId },
      data: { status: 'FAILED_PERMANENT' },
    });

    await db.outboxCommand.update({
      where: { id: outboxCommandId },
      data: { status: 'FAILED' },
    });

    return { success: false, error: 'DISPATCH_UNSUCCESSFUL' };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'UNKNOWN_DISPATCH_ERROR';

    await db.publishAttempt.update({
      where: { id: command.publishAttemptId },
      data: {
        status: 'FAILED_PERMANENT',
        errorMessage,
      },
    });

    await db.outboxCommand.update({
      where: { id: outboxCommandId },
      data: {
        status: 'FAILED',
        lastError: { message: errorMessage, at: new Date().toISOString() },
      },
    });

    return { success: false, error: errorMessage };
  }
}
