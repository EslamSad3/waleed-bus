import { ConflictException, NotFoundException } from '@nestjs/common';

interface PrismaError extends Error {
  code?: string;
  meta?: { target?: string[] | string };
}

/** Translates well-known Prisma errors into stable HTTP semantics. */
export function translatePrismaError(error: unknown, resource = 'Resource'): Error {
  const prismaError = error as PrismaError;
  if (prismaError?.code === 'P2002') {
    const target = prismaError.meta?.target;
    const fields = Array.isArray(target) ? target.join(', ') : (target ?? 'field');
    return new ConflictException(`${resource} already exists (${fields})`);
  }
  if (prismaError?.code === 'P2003') {
    return new ConflictException(`${resource} is referenced by other records`);
  }
  if (prismaError?.code === 'P2025') {
    return new NotFoundException(`${resource} not found`);
  }
  return error as Error;
}
