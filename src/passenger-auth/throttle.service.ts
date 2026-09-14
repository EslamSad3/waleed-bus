import { Injectable } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/prisma.module.js';

export interface ThrottleBudget {
  limit: number;
  windowMs: number;
}

export interface ThrottleVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * DB-backed fixed-window counters (survives serverless instances and
 * restarts). Keys: `login:phone:<n>`, `login:ip:<ip>`,
 * `otp:send:<phone>`, `otp:verify:<challengeId>`.
 * All state lives in `throttle_counters` on the system path — the tenant
 * role holds no grants there (constitution V).
 */
@Injectable()
export class ThrottleService {
  constructor(private readonly system: SystemPrismaService) {}

  async hit(
    key: string,
    budget: ThrottleBudget,
    now: Date = new Date(),
  ): Promise<ThrottleVerdict> {
    return this.system.$transaction(async (tx) => {
      const row = await tx.throttleCounter.findUnique({ where: { key } });
      if (
        !row ||
        row.windowStart.getTime() + budget.windowMs <= now.getTime()
      ) {
        await tx.throttleCounter.upsert({
          where: { key },
          update: { count: 1, windowStart: now },
          create: { key, count: 1, windowStart: now },
        });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (row.count < budget.limit) {
        await tx.throttleCounter.update({
          where: { key },
          data: { count: { increment: 1 } },
        });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(
          (row.windowStart.getTime() + budget.windowMs - now.getTime()) / 1000,
        ),
      );
      return { allowed: false, retryAfterSeconds };
    });
  }

  /**
   * Read-only budget check: reports whether another failure would still be
   * allowed without consuming budget. Login paths peek first and record
   * only genuine failures, so successes never burn the brute-force budget.
   */
  async peek(
    key: string,
    budget: ThrottleBudget,
    now: Date = new Date(),
  ): Promise<ThrottleVerdict> {
    const row = await this.system.throttleCounter.findUnique({
      where: { key },
    });
    if (!row || row.windowStart.getTime() + budget.windowMs <= now.getTime()) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (row.count < budget.limit)
      return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(
          (row.windowStart.getTime() + budget.windowMs - now.getTime()) / 1000,
        ),
      ),
    };
  }

  async reset(key: string): Promise<void> {
    await this.system.throttleCounter.deleteMany({ where: { key } });
  }
}
