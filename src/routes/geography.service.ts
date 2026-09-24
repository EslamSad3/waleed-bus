import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type {
  CreateLocalityDto,
  CreateMarkazDto,
  UpdateLocalityDto,
  UpdateMarkazDto,
} from './dto/route.dto.js';

export const localityWithChain = {
  markaz: { include: { governorate: true } },
};

@Injectable()
export class GeographyService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Markaz ---

  async listMarkaz(governorateId: string) {
    return this.system.markaz.findMany({
      where: { governorateId, isActive: true },
      orderBy: { nameEn: 'asc' },
      include: { governorate: true },
    });
  }

  async findMarkaz(id: string) {
    const markaz = await this.system.markaz.findUnique({
      where: { id },
      include: { governorate: true },
    });
    if (!markaz) throw new NotFoundException('Markaz not found');
    return markaz;
  }

  async createMarkaz(dto: CreateMarkazDto, actorUserId: string) {
    await this.ensureGovernorate(dto.governorateId);
    const markaz = await this.system.markaz
      .create({ data: dto, include: { governorate: true } })
      .catch((error) => {
        throw translatePrismaError(error, 'Markaz');
      });
    await this.audit.log({
      actorUserId,
      action: 'markaz.create',
      resource: 'markaz',
      resourceId: markaz.id,
      metadata: { code: markaz.code, governorateId: dto.governorateId },
    });
    return markaz;
  }

  async updateMarkaz(id: string, dto: UpdateMarkazDto, actorUserId: string) {
    await this.findMarkaz(id);
    const markaz = await this.system.markaz
      .update({ where: { id }, data: dto, include: { governorate: true } })
      .catch((error) => {
        throw translatePrismaError(error, 'Markaz');
      });
    await this.audit.log({
      actorUserId,
      action: 'markaz.update',
      resource: 'markaz',
      resourceId: id,
      metadata: { ...dto },
    });
    return markaz;
  }

  // --- Locality ---

  async listLocalities(markazId: string) {
    return this.system.locality.findMany({
      where: { markazId, isActive: true },
      orderBy: { nameEn: 'asc' },
      include: localityWithChain,
    });
  }

  async findLocality(id: string) {
    const locality = await this.system.locality.findUnique({
      where: { id },
      include: localityWithChain,
    });
    if (!locality) throw new NotFoundException('Locality not found');
    return locality;
  }

  async createLocality(dto: CreateLocalityDto, actorUserId: string) {
    await this.requireActiveMarkaz(dto.markazId);
    const locality = await this.system.locality
      .create({ data: dto, include: localityWithChain })
      .catch((error) => {
        throw translatePrismaError(error, 'Locality');
      });
    await this.audit.log({
      actorUserId,
      action: 'locality.create',
      resource: 'locality',
      resourceId: locality.id,
      metadata: { markazId: dto.markazId, type: dto.type },
    });
    return locality;
  }

  async updateLocality(id: string, dto: UpdateLocalityDto, actorUserId: string) {
    await this.findLocality(id);
    const locality = await this.system.locality
      .update({ where: { id }, data: dto, include: localityWithChain })
      .catch((error) => {
        throw translatePrismaError(error, 'Locality');
      });
    await this.audit.log({
      actorUserId,
      action: 'locality.update',
      resource: 'locality',
      resourceId: id,
      metadata: { ...dto },
    });
    return locality;
  }

  /**
   * Validates the station chain: locality must exist, be active, sit under
   * an active markaz, and resolve to the station's governorate.
   * Used by stop create/update so the API enforces hierarchy independently
   * of the dashboard's dependent dropdowns.
   */
  async requireActiveLocalityInGovernorate(
    localityId: string,
    governorateId: string,
  ) {
    const locality = await this.system.locality.findUnique({
      where: { id: localityId },
      include: { markaz: true },
    });
    if (!locality || !locality.isActive || !locality.markaz?.isActive) {
      throw new CodedException(
        422,
        'INVALID_LOCALITY',
        'المدينة/القرية المختارة غير متاحة.',
      );
    }
    if (locality.markaz.governorateId !== governorateId) {
      throw new CodedException(
        422,
        'INVALID_GEO_HIERARCHY',
        'المدينة/القرية لا تنتمي إلى المحافظة المختارة.',
      );
    }
    return locality;
  }

  private async ensureGovernorate(id: string) {
    const exists = await this.system.governorate.count({ where: { id } });
    if (!exists) {
      throw new CodedException(
        422,
        'INVALID_GOVERNORATE',
        'المحافظة المختارة غير متاحة.',
      );
    }
  }

  private async requireActiveMarkaz(id: string) {
    const markaz = await this.system.markaz.findUnique({ where: { id } });
    if (!markaz || !markaz.isActive) {
      throw new CodedException(
        422,
        'INVALID_MARKAZ',
        'المركز المختار غير متاح.',
      );
    }
    return markaz;
  }
}
