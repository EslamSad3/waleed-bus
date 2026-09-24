import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type {
  CreateVehicleBrandDto,
  UpdateVehicleBrandDto,
} from './dto/bus.dto.js';

@Injectable()
export class VehicleBrandService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  async listBrands() {
    return this.system.vehicleBrand.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findBrand(id: string) {
    const brand = await this.system.vehicleBrand.findUnique({ where: { id } });
    if (!brand) throw new NotFoundException('Vehicle brand not found');
    return brand;
  }

  async createBrand(dto: CreateVehicleBrandDto, actorUserId: string) {
    const brand = await this.system.vehicleBrand
      .create({ data: dto })
      .catch((error) => {
        throw translatePrismaError(error, 'Vehicle brand');
      });
    await this.audit.log({
      actorUserId,
      action: 'brand.create',
      resource: 'vehicle_brand',
      resourceId: brand.id,
      metadata: { name: brand.name },
    });
    return brand;
  }

  async updateBrand(id: string, dto: UpdateVehicleBrandDto, actorUserId: string) {
    await this.findBrand(id);
    const brand = await this.system.vehicleBrand
      .update({ where: { id }, data: dto })
      .catch((error) => {
        throw translatePrismaError(error, 'Vehicle brand');
      });
    await this.audit.log({
      actorUserId,
      action: 'brand.update',
      resource: 'vehicle_brand',
      resourceId: id,
      metadata: { ...dto },
    });
    return brand;
  }

  /** Used by bus create/update so only active brands can be assigned. */
  async requireActiveBrand(id: string) {
    const brand = await this.system.vehicleBrand.findUnique({ where: { id } });
    if (!brand || !brand.isActive) {
      throw new CodedException(
        422,
        'INVALID_BRAND',
        'ماركة الأتوبيس المختارة غير متاحة.',
      );
    }
    return brand;
  }
}
