import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type {
  CreateVipTierDto,
  UpdateVipTierDto,
} from './dto/discovery.dto.js';

@Injectable()
export class VipTierService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  async listTiers() {
    return this.system.vipTier.findMany({
      where: { isActive: true },
      orderBy: { rank: 'asc' },
    });
  }

  async findTier(id: string) {
    const tier = await this.system.vipTier.findUnique({ where: { id } });
    if (!tier) throw new NotFoundException('VIP tier not found');
    return tier;
  }

  async createTier(dto: CreateVipTierDto, actorUserId: string) {
    const tier = await this.system.vipTier
      .create({ data: dto })
      .catch((error) => {
        throw translatePrismaError(error, 'VIP tier');
      });
    await this.audit.log({
      actorUserId,
      action: 'vip_tier.create',
      resource: 'vip_tier',
      resourceId: tier.id,
      metadata: { name: tier.name, rank: tier.rank },
    });
    return tier;
  }

  async updateTier(id: string, dto: UpdateVipTierDto, actorUserId: string) {
    await this.findTier(id);
    const tier = await this.system.vipTier
      .update({ where: { id }, data: dto })
      .catch((error) => {
        throw translatePrismaError(error, 'VIP tier');
      });
    await this.audit.log({
      actorUserId,
      action: 'vip_tier.update',
      resource: 'vip_tier',
      resourceId: id,
      metadata: { ...dto },
    });
    return tier;
  }

  /** Used by fleet VIP assignment so only active tiers can be assigned. */
  async requireActiveTier(id: string) {
    const tier = await this.system.vipTier.findUnique({ where: { id } });
    if (!tier || !tier.isActive) {
      throw new CodedException(
        422,
        'VIP_TIER_NOT_AVAILABLE',
        'مستوى VIP المختار غير متاح.',
      );
    }
    return tier;
  }
}
