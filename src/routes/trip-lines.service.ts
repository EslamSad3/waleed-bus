import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { CreateStopDto, CreateTripLineDto, TripLineStopDto, UpdateStopDto, UpdateTripLineDto } from './dto/route.dto.js';

const routeInclude = {
  stations: { orderBy: { stopOrder: 'asc' as const }, include: { station: true } },
};
const lineInclude = { directions: { orderBy: { direction: 'asc' as const }, include: routeInclude } };

@Injectable()
export class TripLinesService {
  constructor(private readonly system: SystemPrismaService, private readonly audit: AuditService) {}

  async findStops() {
    return this.system.station.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  }

  async findStop(id: string) {
    return this.getStop(id);
  }

  async createStop(dto: CreateStopDto, actorUserId: string) {
    const stop = await this.system.station.create({ data: dto });
    await this.audit.log({ actorUserId, action: 'stop.create', resource: 'station', resourceId: stop.id, metadata: { name: stop.name } });
    return stop;
  }

  async updateStop(id: string, dto: UpdateStopDto, actorUserId: string) {
    await this.getStop(id);
    const stop = await this.system.station.update({ where: { id }, data: dto });
    await this.audit.log({ actorUserId, action: 'stop.update', resource: 'station', resourceId: id, metadata: { ...dto } });
    return stop;
  }

  async removeStop(id: string, actorUserId: string) {
    await this.getStop(id);
    const references = await this.system.routeStation.count({ where: { stationId: id } });
    if (references) throw new CodedException(409, 'STOP_IN_USE', 'لا يمكن حذف نقطة توقف مستخدمة في خط رحلة. أوقفها بدلًا من ذلك.');
    await this.system.station.delete({ where: { id } });
    await this.audit.log({ actorUserId, action: 'stop.delete', resource: 'station', resourceId: id });
  }

  async findTripLines() {
    return (await this.system.line.findMany({ orderBy: { createdAt: 'desc' }, include: lineInclude })).map((line) => this.presentLine(line));
  }

  async findTripLine(id: string) { return this.presentLine(await this.getTripLine(id)); }

  async createTripLine(dto: CreateTripLineDto, actorUserId: string) {
    const outbound = await this.resolveStops(dto.outboundStops); const inbound = await this.resolveStops(dto.returnStops);
    const line = await this.system.$transaction(async (tx) => {
      const parent = await tx.line.create({ data: { name: dto.name, code: dto.code, isActive: dto.isActive ?? true } });
      const createDirection = (direction: string, stops: typeof outbound, inputs: TripLineStopDto[]) => tx.route.create({ data: { lineId: parent.id, direction, name: dto.name, code: `${dto.code}-${direction === 'OUTBOUND' ? 'OUT' : 'RET'}`, isActive: dto.isActive ?? true, origin: stops[0].name, destination: stops.at(-1)!.name, qrIdentifier: `line_${randomUUID()}`, stations: { create: stops.map((stop, index) => ({ stationId: stop.id, stopOrder: index + 1, estimatedStopMinutes: inputs[index].estimatedStopMinutes })) } } });
      await createDirection('OUTBOUND', outbound, dto.outboundStops); await createDirection('RETURN', inbound, dto.returnStops);
      return tx.line.findUniqueOrThrow({ where: { id: parent.id }, include: lineInclude });
    }).catch((error) => { throw translatePrismaError(error, 'Trip line'); });
    await this.audit.log({ actorUserId, action: 'trip_line.create', resource: 'line', resourceId: line.id, metadata: { name: line.name, code: line.code } });
    return this.presentLine(line);
  }

  async updateTripLine(id: string, dto: UpdateTripLineDto, actorUserId: string) {
    await this.getTripLine(id);
    const line = await this.system.line.update({ where: { id }, data: { name: dto.name, code: dto.code, isActive: dto.isActive }, include: lineInclude }).catch((error) => { throw translatePrismaError(error, 'Trip line'); });
    await this.audit.log({ actorUserId, action: 'trip_line.update', resource: 'line', resourceId: id, metadata: { ...dto } }); return this.presentLine(line);
  }

  async updateDirectionStops(lineId: string, directionId: string, stopInputs: TripLineStopDto[], actorUserId: string) {
    const line = await this.getTripLine(lineId);
    const direction = line.directions.find((item) => item.id === directionId);
    if (!direction) throw new NotFoundException('Trip-line direction not found');
    if (await this.system.trip.count({ where: { routeId: directionId } })) {
      throw new CodedException(409, 'DIRECTION_IN_USE', 'لا يمكن تعديل اتجاه مرتبط برحلات قائمة أو سابقة. أنشئ خطًا جديدًا للتغيير التشغيلي.');
    }
    const stops = await this.resolveStops(stopInputs);
    const updated = await this.system.$transaction(async (tx) => {
      await tx.routeStation.deleteMany({ where: { routeId: directionId } });
      await tx.route.update({
        where: { id: directionId },
        data: {
          origin: stops[0].name,
          destination: stops.at(-1)!.name,
          stations: { create: stops.map((stop, index) => ({ stationId: stop.id, stopOrder: index + 1, estimatedStopMinutes: stopInputs[index].estimatedStopMinutes })) },
        },
      });
      return tx.line.findUniqueOrThrow({ where: { id: lineId }, include: lineInclude });
    }).catch((error) => { throw translatePrismaError(error, 'Trip-line direction'); });
    await this.audit.log({ actorUserId, action: 'trip_line.direction.update', resource: 'route', resourceId: directionId, metadata: { lineId, direction: direction.direction, stopCount: stops.length } });
    return this.presentLine(updated);
  }

  async removeTripLine(id: string, actorUserId: string) {
    await this.getTripLine(id);
    const line = await this.getTripLine(id);
    if (await this.system.trip.count({ where: { routeId: { in: line.directions.map((direction) => direction.id) } } })) throw new CodedException(409, 'TRIP_LINE_IN_USE', 'لا يمكن حذف خط مرتبط برحلات. أوقفه بدلًا من ذلك.');
    await this.system.line.delete({ where: { id } }); await this.audit.log({ actorUserId, action: 'trip_line.delete', resource: 'line', resourceId: id });
  }

  private async getStop(id: string) {
    const stop = await this.system.station.findUnique({ where: { id } });
    if (!stop) throw new NotFoundException('Stop not found');
    return stop;
  }

  private async getTripLine(id: string) {
    const line = await this.system.line.findUnique({ where: { id }, include: lineInclude });
    if (!line) throw new NotFoundException('Trip line not found'); return line;
  }

  private presentLine(line: any) {
    const outbound = line.directions.find((direction: any) => direction.direction === 'OUTBOUND') ?? line.directions[0];
    return { ...line, origin: outbound?.origin ?? '', destination: outbound?.destination ?? '', stations: outbound?.stations ?? [] };
  }

  private async resolveStops(stopInputs: TripLineStopDto[]) {
    if (new Set(stopInputs.map((stop) => stop.stopId)).size !== stopInputs.length) {
      throw new CodedException(422, 'DUPLICATE_STOP', 'لا يمكن تكرار نقطة التوقف نفسها داخل خط واحد.', { fields: { stops: 'كل نقطة توقف يجب أن تظهر مرة واحدة فقط.' } });
    }
    const stops = await this.system.station.findMany({ where: { isActive: true, id: { in: stopInputs.map((stop) => stop.stopId) } } });
    if (stops.length !== stopInputs.length) throw new CodedException(422, 'INVALID_STOP', 'بعض نقاط التوقف غير متاحة.', { fields: { stops: 'اختر نقاط توقف نشطة.' } });
    const indexed = new Map(stops.map((stop) => [stop.id, stop]));
    return stopInputs.map((input) => indexed.get(input.stopId)!);
  }
}
