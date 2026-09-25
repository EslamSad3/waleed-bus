/**
 * Bounded retry for interactive-transaction START failures (shared).
 *
 * Prisma raises P2028 ("Unable to start a transaction in the given time")
 * and P2024 (pool checkout timeout) BEFORE BEGIN completes — e.g. against a
 * transaction-mode pooler under load or during pool warmup. Nothing has
 * executed at that point, so retrying the whole unit (including the
 * callback) cannot double-apply writes. Any other error propagates
 * immediately without retrying.
 */
const TX_START_RETRYABLE = new Set(['P2028', 'P2024']);
const TX_START_MAX_ATTEMPTS = 3;

export async function withTxStartRetry<T>(
  run: () => Promise<T>,
  attempts: number = TX_START_MAX_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const code = (error as { code?: unknown })?.code;
      const retryable =
        typeof code === 'string' &&
        TX_START_RETRYABLE.has(code) &&
        attempt < attempts;
      if (!retryable) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError;
}
