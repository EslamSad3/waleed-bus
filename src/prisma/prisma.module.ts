import {
  Global,
  Injectable,
  Module,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { ConfigService } from '../config/config.module.js';

/**
 * PRIVILEGED path (table owner): migrations, seed, and super-admin platform
 * endpoints only. Never use for ordinary tenant-scoped request data.
 */
@Injectable()
export class SystemPrismaService
  extends PrismaClient
  implements OnModuleDestroy
{
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.config.database.systemUrl,
      }),
    });
  }

  onModuleDestroy(): Promise<void> {
    return this.$disconnect();
  }
}

/**
 * RLS-ENFORCED path (role `app_tenant`, non-owner, no BYPASSRLS): every normal
 * tenant request must run through this client inside a TenantContextService
 * transaction that sets app.user_id / app.fleet_id.
 */
@Injectable()
export class TenantPrismaService
  extends PrismaClient
  implements OnModuleDestroy
{
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.config.database.tenantUrl,
      }),
    });
  }

  onModuleDestroy(): Promise<void> {
    return this.$disconnect();
  }
}

@Global()
@Module({
  providers: [SystemPrismaService, TenantPrismaService],
  exports: [SystemPrismaService, TenantPrismaService],
})
export class PrismaModule {}
