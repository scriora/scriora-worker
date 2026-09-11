import { describe, it, expect, vi } from 'vitest';
import { processOutboxCommand } from '../../src/handlers/outbox-dispatcher.js';

describe('Outbox Dispatcher Unit Tests', () => {
  it('dispatches command to platform adapter and updates records to SUCCEEDED and PUBLISHED', async () => {
    const mockTx = {
      publishAttempt: { update: vi.fn().mockResolvedValue({}) },
      publication: { update: vi.fn().mockResolvedValue({}) },
      outboxCommand: { update: vi.fn().mockResolvedValue({}) },
    };
    const mockDb = {
      outboxCommand: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'outbox-1',
          workspaceId: 'ws-1',
          publicationId: 'pub-1',
          publishAttemptId: 'attempt-1',
          status: 'PENDING',
          payload: {
            platform: 'LINKEDIN',
            socialAccountId: 'acc-1',
            body: 'Test post for LinkedIn',
            idempotencyKey: 'idemp-123',
            fingerprint: 'a'.repeat(64),
          },
          publication: { id: 'pub-1', externalPostId: null },
          publishAttempt: { id: 'attempt-1' },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      publishAttempt: { update: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
    };

    const result = await processOutboxCommand(mockDb as any, 'outbox-1');

    expect(result.success).toBe(true);
    expect(result.externalPostId).toMatch(/^urn:li:share:/);
    expect(mockTx.publication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pub-1' },
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      })
    );
    expect(mockTx.publishAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-1' },
        data: expect.objectContaining({ status: 'SUCCEEDED' }),
      })
    );
  });

  it('returns early if command is already PUBLISHED', async () => {
    const mockDb = {
      outboxCommand: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'outbox-already-published',
          status: 'PUBLISHED',
          publication: { id: 'pub-1', externalPostId: 'urn:li:share:12345' },
        }),
        update: vi.fn(),
      },
    };

    const result = await processOutboxCommand(mockDb as any, 'outbox-already-published');
    expect(result.success).toBe(true);
    expect(result.externalPostId).toBe('urn:li:share:12345');
    expect(mockDb.outboxCommand.update).not.toHaveBeenCalled();
  });

  it('throws when command does not exist', async () => {
    const mockDb = {
      outboxCommand: { findUnique: vi.fn().mockResolvedValue(null) },
    };

    await expect(processOutboxCommand(mockDb as any, 'non-existent')).rejects.toThrow(
      'OUTBOX_COMMAND_NOT_FOUND'
    );
  });

  it('handles unsuccessful dispatch from platform adapter', async () => {
    const mockDb = {
      outboxCommand: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'outbox-fail',
          workspaceId: 'ws-1',
          publicationId: 'pub-1',
          publishAttemptId: 'attempt-fail',
          status: 'PENDING',
          payload: {
            platform: 'LINKEDIN',
            socialAccountId: 'acc-1',
            body: 'Test post',
            idempotencyKey: 'idemp-456',
            fingerprint: 'b'.repeat(64),
          },
          publication: { id: 'pub-1' },
          publishAttempt: { id: 'attempt-fail' },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      publishAttempt: { update: vi.fn().mockResolvedValue({}) },
    };

    const { platformRegistry } = await import('scriora-social');
    const adapter = platformRegistry.get('LINKEDIN' as any);
    const publishSpy = vi.spyOn(adapter, 'publish').mockResolvedValueOnce({
      status: 'FAILED_PERMANENT',
      error: 'Invalid token',
    } as any);

    const result = await processOutboxCommand(mockDb as any, 'outbox-fail');
    expect(result.success).toBe(false);
    expect(result.error).toBe('DISPATCH_UNSUCCESSFUL');
    expect(mockDb.publishAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-fail' },
        data: { status: 'FAILED_PERMANENT' },
      })
    );
    expect(mockDb.outboxCommand.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-fail' },
        data: { status: 'FAILED' },
      })
    );

    publishSpy.mockRestore();
  });

  it('handles runtime exceptions thrown during dispatch', async () => {
    const mockDb = {
      outboxCommand: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'outbox-error',
          workspaceId: 'ws-1',
          publicationId: 'pub-1',
          publishAttemptId: 'attempt-err',
          status: 'PENDING',
          payload: {
            platform: 'LINKEDIN',
            socialAccountId: 'acc-1',
            body: 'Test post',
            idempotencyKey: 'idemp-789',
            fingerprint: 'c'.repeat(64),
          },
          publication: { id: 'pub-1' },
          publishAttempt: { id: 'attempt-err' },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      publishAttempt: { update: vi.fn().mockResolvedValue({}) },
    };

    const { platformRegistry } = await import('scriora-social');
    const adapter = platformRegistry.get('LINKEDIN' as any);
    const publishSpy = vi.spyOn(adapter, 'publish').mockRejectedValueOnce(new Error('Network failure'));

    const result = await processOutboxCommand(mockDb as any, 'outbox-error');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Network failure');
    expect(mockDb.publishAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-err' },
        data: expect.objectContaining({
          status: 'FAILED_PERMANENT',
          errorMessage: 'Network failure',
        }),
      })
    );
    expect(mockDb.outboxCommand.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-error' },
        data: expect.objectContaining({ status: 'FAILED' }),
      })
    );

    publishSpy.mockRestore();
  });

  it('handles already PUBLISHED command when publication has no externalPostId', async () => {
    const mockDb = {
      outboxCommand: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'outbox-already-published-no-id',
          status: 'PUBLISHED',
          publication: { id: 'pub-1', externalPostId: null },
        }),
        update: vi.fn(),
      },
    };

    const result = await processOutboxCommand(mockDb as any, 'outbox-already-published-no-id');
    expect(result.success).toBe(true);
    expect(result.externalPostId).toBeUndefined();
  });

  it('handles non-Error thrown during dispatch and missing body', async () => {
    const mockDb = {
      outboxCommand: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'outbox-string-err',
          workspaceId: 'ws-1',
          publicationId: 'pub-1',
          publishAttemptId: 'attempt-err-2',
          status: 'PENDING',
          payload: {
            platform: 'LINKEDIN',
            socialAccountId: 'acc-1',
            idempotencyKey: 'idemp-999',
            fingerprint: 'd'.repeat(64),
          },
          publication: { id: 'pub-1' },
          publishAttempt: { id: 'attempt-err-2' },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      publishAttempt: { update: vi.fn().mockResolvedValue({}) },
    };

    const { platformRegistry } = await import('scriora-social');
    const adapter = platformRegistry.get('LINKEDIN' as any);
    const publishSpy = vi.spyOn(adapter, 'publish').mockRejectedValueOnce('raw-string-exception');

    const result = await processOutboxCommand(mockDb as any, 'outbox-string-err');
    expect(result.success).toBe(false);
    expect(result.error).toBe('UNKNOWN_DISPATCH_ERROR');
    expect(mockDb.publishAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-err-2' },
        data: expect.objectContaining({
          status: 'FAILED_PERMANENT',
          errorMessage: 'UNKNOWN_DISPATCH_ERROR',
        }),
      })
    );

    publishSpy.mockRestore();
  });

  it('dispatches command with externalPostUrl populated on adapter result', async () => {
    const mockTx = {
      publishAttempt: { update: vi.fn().mockResolvedValue({}) },
      publication: { update: vi.fn().mockResolvedValue({}) },
      outboxCommand: { update: vi.fn().mockResolvedValue({}) },
    };
    const mockDb = {
      outboxCommand: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'outbox-with-url',
          workspaceId: 'ws-1',
          publicationId: 'pub-1',
          publishAttemptId: 'attempt-url',
          status: 'PENDING',
          payload: {
            platform: 'LINKEDIN',
            socialAccountId: 'acc-1',
            body: 'Post with external URL',
            idempotencyKey: 'idemp-url',
            fingerprint: 'e'.repeat(64),
          },
          publication: { id: 'pub-1' },
          publishAttempt: { id: 'attempt-url' },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      publishAttempt: { update: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
    };

    const { platformRegistry } = await import('scriora-social');
    const adapter = platformRegistry.get('LINKEDIN' as any);
    const publishSpy = vi.spyOn(adapter, 'publish').mockResolvedValueOnce({
      status: 'SUCCEEDED',
      externalPostId: 'urn:li:share:with-url',
      externalPostUrl: 'https://linkedin.com/posts/with-url',
    } as any);

    const result = await processOutboxCommand(mockDb as any, 'outbox-with-url');
    expect(result.success).toBe(true);
    expect(result.externalPostUrl).toBe('https://linkedin.com/posts/with-url');
    expect(mockTx.publishAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-url' },
        data: expect.objectContaining({
          externalUrl: 'https://linkedin.com/posts/with-url',
        }),
      })
    );

    publishSpy.mockRestore();
  });

  it('handles SUCCEEDED status from adapter without externalPostId as failure', async () => {
    const mockDb = {
      outboxCommand: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'outbox-no-id',
          workspaceId: 'ws-1',
          publicationId: 'pub-1',
          publishAttemptId: 'attempt-no-id',
          status: 'PENDING',
          payload: {
            platform: 'LINKEDIN',
            socialAccountId: 'acc-1',
            body: 'Test post',
            idempotencyKey: 'idemp-no-id',
            fingerprint: 'f'.repeat(64),
          },
          publication: { id: 'pub-1' },
          publishAttempt: { id: 'attempt-no-id' },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      publishAttempt: { update: vi.fn().mockResolvedValue({}) },
    };

    const { platformRegistry } = await import('scriora-social');
    const adapter = platformRegistry.get('LINKEDIN' as any);
    const publishSpy = vi.spyOn(adapter, 'publish').mockResolvedValueOnce({
      status: 'SUCCEEDED',
    } as any);

    const result = await processOutboxCommand(mockDb as any, 'outbox-no-id');
    expect(result.success).toBe(false);
    expect(result.error).toBe('DISPATCH_UNSUCCESSFUL');

    publishSpy.mockRestore();
  });
});
