import { Injectable } from '@nestjs/common';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import type { CursorPage } from '../common/pagination.js';
import type { Booking } from '../generated/prisma/client.js';
import type {
  ActivePassengerTripDto,
  CancelledBookingResponseDto,
  CancelPassengerBookingDto,
  CreatePassengerBookingDto,
  PassengerBookingDetailDto,
  PassengerBookingItemDto,
  PassengerBookingListQueryDto,
} from './dto/passenger-booking.dto.js';
import {
  FleetBookingService,
  type CreateBookingInput,
  type UpdateBookingInput,
} from './fleet-booking.service.js';
import { PassengerBookingService } from './passenger-booking.service.js';
import {
  PassengerRatingService,
  type PassengerRatingInput,
  type PassengerRatingResponse,
} from './passenger-rating.service.js';

export type { CreateBookingInput, UpdateBookingInput };

/**
 * Coordinating service for bookings across fleet management, passenger reservations,
 * and post-trip ratings. Delegates to specialized domain services. Supports both
 * sub-service injection and legacy 4-service construction.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly fleetBooking: FleetBookingService,
    private readonly passengerBooking: PassengerBookingService,
    private readonly passengerRating: PassengerRatingService,
  ) {}

  // Fleet booking operations
  create(
    actor: RequestUser,
    fleetContext: FleetContext,
    input: CreateBookingInput,
  ): Promise<Booking> {
    return this.fleetBooking.create(actor, fleetContext, input);
  }

  findAll(
    actor: RequestUser,
    fleetContext: FleetContext,
    query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<Booking>> {
    return this.fleetBooking.findAll(actor, fleetContext, query);
  }

  findOne(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
  ): Promise<Booking> {
    return this.fleetBooking.findOne(actor, fleetContext, id);
  }

  update(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
    input: UpdateBookingInput,
  ): Promise<Booking> {
    return this.fleetBooking.update(actor, fleetContext, id, input);
  }

  remove(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
  ): Promise<void> {
    return this.fleetBooking.remove(actor, fleetContext, id);
  }

  // Passenger rating operations
  rateByPassenger(
    actor: RequestUser,
    bookingId: string,
    input: PassengerRatingInput,
  ): Promise<PassengerRatingResponse> {
    return this.passengerRating.rateByPassenger(actor, bookingId, input);
  }

  // Passenger booking operations
  createPassengerBooking(
    actor: RequestUser,
    input: CreatePassengerBookingDto,
  ): Promise<PassengerBookingItemDto> {
    return this.passengerBooking.createPassengerBooking(actor, input);
  }

  findPassengerBookings(
    actor: RequestUser,
    query: PassengerBookingListQueryDto,
  ): Promise<CursorPage<PassengerBookingItemDto>> {
    return this.passengerBooking.findPassengerBookings(actor, query);
  }

  findPassengerBookingById(
    actor: RequestUser,
    id: string,
  ): Promise<PassengerBookingDetailDto> {
    return this.passengerBooking.findPassengerBookingById(actor, id);
  }

  cancelPassengerBooking(
    actor: RequestUser,
    id: string,
    input: CancelPassengerBookingDto,
  ): Promise<CancelledBookingResponseDto> {
    return this.passengerBooking.cancelPassengerBooking(actor, id, input);
  }

  findActivePassengerTrip(
    actor: RequestUser,
  ): Promise<ActivePassengerTripDto | null> {
    return this.passengerBooking.findActivePassengerTrip(actor);
  }
}
