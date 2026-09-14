import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type { AdminResolveReportDto } from './dto/admin-report.dto.js';
import type { AdminResolveReportResponseDto } from './dto/admin-booking-response.dto.js';

@Injectable()
export class AdminReportService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  async resolveReport(
    bookingId: string,
    reportId: string,
    actorUserId: string,
    dto: AdminResolveReportDto,
  ): Promise<AdminResolveReportResponseDto> {
    if (!['RESOLVED', 'DISMISSED'].includes(dto.status)) {
      throw new CodedException(
        400,
        'INVALID_REPORT_STATUS',
        'Report status must be RESOLVED or DISMISSED',
      );
    }

    return this.system.$transaction(async (tx) => {
      const report = await tx.passengerReport.findUnique({
        where: { id: reportId },
      });
      if (!report || report.bookingId !== bookingId) {
        throw new CodedException(
          404,
          'REPORT_NOT_FOUND',
          'Passenger incident report not found for this booking',
        );
      }

      const now = new Date();
      const updated = await tx.passengerReport.update({
        where: { id: reportId },
        data: {
          status: dto.status,
          resolutionNote: dto.resolutionNote,
          resolvedAt: now,
          resolvedBy: actorUserId,
        },
      });

      await this.audit.log({
        actorUserId,
        action: 'report.resolve',
        resource: 'passenger_reports',
        resourceId: reportId,
        metadata: {
          bookingId,
          previousStatus: report.status,
          newStatus: dto.status,
          resolutionNote: dto.resolutionNote,
        },
      });

      return {
        id: updated.id,
        bookingId: updated.bookingId,
        driverId: updated.driverId,
        passengerId: updated.passengerId,
        driverNote: updated.note,
        status: updated.status,
        resolutionNote: updated.resolutionNote,
        resolvedBy: updated.resolvedBy,
        resolvedAt: updated.resolvedAt,
        updatedAt: updated.updatedAt,
      };
    });
  }
}
