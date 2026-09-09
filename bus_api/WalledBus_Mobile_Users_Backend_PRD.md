# Microbus Transportation Platform — Mobile App Users Backend PRD

## 1. Purpose

Backend requirements and API contracts for the mobile application users only.

Existing backend infrastructure and Admin Dashboard are already implemented and are outside this document.

Mobile roles:

- Passenger
- Fleet Owner
- Bus Driver

---

# 2. Passenger

## 2.1 Account Creation

Passenger has two account creation methods.

### A. Phone + Password

| Field | Required |
|---|---:|
| Name | Yes |
| Phone Number | Yes |
| Picture | No |
| Password | Yes |

Phone number is required and must be verified with OTP.

Flow:

```text
Name + Phone + Password
        ↓
Send OTP
        ↓
Verify OTP
        ↓
Passenger account created/activated
```

### B. Google / Apple

Passenger may create/login using Google or Apple.

The provider identity is used for authentication, but the application's phone number remains mandatory.

If the provider does not supply a usable phone number, or the phone is not verified for this application:

```text
Google / Apple Login
        ↓
Create/find Passenger
        ↓
Check phone
        ↓
Missing/unverified
        ↓
Complete Profile
        ↓
Enter Phone Number
        ↓
Send OTP
        ↓
Verify OTP
        ↓
Phone verified
        ↓
Profile complete
```

If a verified phone already exists, the Passenger can continue without entering it again.

Passenger capabilities:

- Login/register
- Manage profile
- Search routes and trips
- View route/station details
- View trip details
- Book one or multiple seats
- Select an available payment method
- View bookings
- Cancel a booking before the trip starts
- View active trip
- View live bus location
- Share an active trip securely
- Scan route/bus QR codes
- Rate the bus used for the trip
- Rate the driver of the bus
- Receive notifications
- Contact support

---

# 3. Authentication

## 3.1 Shared Login API

```http
POST /auth/login
```

Required request field:

```text
loginType
```

Supported values:

```text
PASSENGER
FLEET_OWNER
DRIVER
```

Passenger password login:

```json
{
  "loginType": "PASSENGER",
  "phone": "01000000000",
  "password": "********"
}
```

Fleet Owner:

```json
{
  "loginType": "FLEET_OWNER",
  "phone": "01000000000",
  "password": "********"
}
```

Driver:

```json
{
  "loginType": "DRIVER",
  "phone": "01000000000",
  "password": "********"
}
```

Passenger Google:

```json
{
  "loginType": "PASSENGER",
  "provider": "GOOGLE",
  "idToken": "..."
}
```

Passenger Apple:

```json
{
  "loginType": "PASSENGER",
  "provider": "APPLE",
  "idToken": "..."
}
```

The backend validates the actual account type. `loginType` must not itself grant authorization.

## 3.2 Generic Authentication Errors

Authentication responses must be generic.

Do not reveal:

- whether a phone number exists
- whether an account exists
- the user's role
- whether a password was correct
- whether a social account is linked
- whether an account is a Driver/Fleet Owner/Passenger

Do not return:

```text
This account is a Driver.
```

or:

```text
No Passenger account exists.
```

Use a generic response:

```json
{
  "success": false,
  "error": {
    "code": "AUTHENTICATION_FAILED",
    "message": "Unable to authenticate with the provided credentials."
  }
}
```

The same principle applies to account-type mismatch.

---

# 4. Passenger Phone Verification

## Send OTP

```http
POST /auth/phone/send-otp
```

```json
{
  "phoneNumber": "01000000000"
}
```

Used for:

- Passenger standard registration
- Completing Google/Apple Passenger profile
- Verifying a newly entered phone number

Backend must enforce:

- OTP expiration
- resend cooldown
- attempt limit
- rate limiting
- one-time use

OTP must never be returned by the API.

## Verify OTP

```http
POST /auth/phone/verify-otp
```

```json
{
  "phoneNumber": "01000000000",
  "otp": "123456"
}
```

On success:

```json
{
  "success": true,
  "phoneVerified": true
}
```

The phone becomes verified only after successful OTP verification.

---

# 5. Passenger Profile Completion

For Google/Apple accounts:

```http
GET /me/profile-status
```

Example:

```json
{
  "profileComplete": false,
  "missingFields": [
    "phoneNumber"
  ],
  "phoneVerified": false
}
```

Profile update:

```http
PATCH /me
```

Example:

```json
{
  "name": "Ahmed",
  "phoneNumber": "01000000000"
}
```

A newly entered phone remains unverified until OTP verification succeeds.

---

# 6. User Data

Logical model:

```text
User
- id
- role
- name
- nickname
- phoneNumber
- phoneVerifiedAt
- picture
- passwordCredential
- nationalId
- status
- createdAt
- updatedAt
```

Social identities may be stored separately:

```text
UserAuthProvider
- id
- userId
- provider
- providerUserId
- createdAt
- updatedAt
```

Providers:

```text
GOOGLE
APPLE
```

---

# 7. Fleet Owner

## Data

| Field | Required |
|---|---:|
| Name | Yes |
| Nickname | Yes |
| Phone Number | Yes |
| Password | Yes |
| Picture | No |
| National ID | No |

Fleet Owners are created from the existing Admin Dashboard.

The mobile app does not create Fleet Owner accounts.

## Capabilities

- Login
- View/update allowed profile data
- View owned buses
- View bus details
- View trips
- View reports/data exposed by mobile
- Assign driver
- Change driver
- Remove driver
- Add/register bus
- Modify bus
- Disable bus
- Reactivate bus

## APIs

```http
GET /me
PATCH /me

GET /fleet/buses
GET /fleet/buses/{busId}

GET /fleet/trips
GET /fleet/trips/{tripId}

GET /fleet/reports

POST /fleet/buses
PATCH /fleet/buses/{busId}
POST /fleet/buses/{busId}/disable
POST /fleet/buses/{busId}/reactivate

POST /fleet/buses/{busId}/driver
DELETE /fleet/buses/{busId}/driver
```

### Future Request-Oriented Design

These actions are direct today.

However, backend business logic should be separated from the mobile controller/database layer so the same operations can become request/approval based later.

Current:

```text
Fleet Owner → API → Business Service → Apply Change
```

Potential future:

```text
Fleet Owner → API → Business Service → Request → Approval → Apply Change
```

---

# 8. Bus Driver

## Data

| Field | Required |
|---|---:|
| Name | Yes |
| Nickname | Yes |
| Phone Number | Yes |
| Password | Yes |
| Picture | No |
| National ID | No |

Drivers are created from the existing Admin Dashboard.

Drivers do not self-register through the Passenger registration flow.

## Capabilities

- Login
- View profile
- View assigned bus
- View assigned trips
- View current trip
- View passengers
- View passenger name
- View passenger pickup address
- View passenger phone number
- Confirm boarding
- Record station drop-off
- Record no-drop-off reason
- Mark passenger as paid by cash
- Rate passengers
- Report passenger with a note
- Complete trip
- Send live location
- Receive notifications

## APIs

```http
GET /me
PATCH /me

GET /driver/bus
GET /driver/bus/{busId}

GET /driver/trips
GET /driver/trips/{tripId}
GET /driver/trips/current

GET /driver/trips/{tripId}/passengers

POST /driver/trips/{tripId}/passengers/{bookingId}/board
POST /driver/trips/{tripId}/passengers/{bookingId}/dropoff
POST /driver/trips/{tripId}/passengers/{bookingId}/payment
POST /driver/trips/{tripId}/passengers/{bookingId}/rating
POST /driver/trips/{tripId}/passengers/{bookingId}/report

POST /driver/trips/{tripId}/complete
```

---

# 9. Driver Passenger Data

The Driver can view:

```text
Name
Pickup Address
Phone Number
Seat Count
Boarding Status
Drop-Off Status
```

Only the Driver assigned to the relevant trip can access this data.

---

# 10. Driver Boarding

```http
POST /driver/trips/{tripId}/passengers/{bookingId}/board
```

Validate:

- Driver is authenticated
- Driver is assigned to trip
- Booking belongs to trip
- Booking is valid
- Trip is operationally valid

---

# 11. Driver Drop-Off

```http
POST /driver/trips/{tripId}/passengers/{bookingId}/dropoff
```

Successful:

```json
{
  "status": "DROPPED_OFF",
  "stationId": "station_123"
}
```

Not dropped off:

```json
{
  "status": "NOT_DROPPED_OFF",
  "reason": "PASSENGER_DID_NOT_EXIT"
}
```

A reason is required for `NOT_DROPPED_OFF`.

---

# 12. Driver Cash Payment

```http
POST /driver/trips/{tripId}/passengers/{bookingId}/payment
```

Example:

```json
{
  "method": "CASH",
  "status": "PAID"
}
```

Backend validates:

- Driver assignment
- Booking/trip relationship
- Payment eligibility
- Current payment state

The Driver cannot modify the payment amount.

The amount comes from the authoritative booking/payment record.

Store:

```text
paymentMethod
paymentStatus
amount
markedBy
markedAt
```

---

# 13. Passenger Ratings

A Passenger can rate:

- The bus used for the trip
- The Driver of the bus

```http
POST /bookings/{bookingId}/rating
```

Example:

```json
{
  "busRating": 5,
  "driverRating": 4
}
```

Backend validates:

- Booking belongs to Passenger
- Passenger actually booked the trip
- Trip is in an eligible rating state
- Bus belongs to the trip
- Driver belongs to the trip
- Rating range is valid
- Duplicate rating behavior is enforced

Passenger cannot rate arbitrary buses or Drivers.

---

# 14. Driver Ratings

A Driver can rate a Passenger after the relevant trip.

```http
POST /driver/trips/{tripId}/passengers/{bookingId}/rating
```

Example:

```json
{
  "rating": 5
}
```

Backend validates:

- Driver is assigned to trip
- Booking belongs to trip
- Passenger belongs to booking
- Driver is eligible to rate Passenger
- Rating range is valid

---

# 15. Driver Passenger Reports

```http
POST /driver/trips/{tripId}/passengers/{bookingId}/report
```

Example:

```json
{
  "note": "Passenger caused an operational issue during the trip."
}
```

Logical record:

```text
PassengerReport
- id
- tripId
- bookingId
- passengerId
- driverId
- note
- createdAt
```

Reports are for authorized backend/admin workflows.

---

# 16. Passenger Booking

```http
POST /bookings
```

Example:

```json
{
  "tripId": "trip_123",
  "seatCount": 2,
  "paymentMethod": "CASH"
}
```

Backend must:

1. Authenticate Passenger.
2. Validate account status.
3. Validate trip.
4. Validate trip status.
5. Validate seat availability.
6. Validate seat count.
7. Validate payment method.
8. Check duplicate-time booking.
9. Reserve seats atomically.
10. Create booking.
11. Create payment state.
12. Return authoritative booking.

---

# 17. Booking Concurrency

If one seat remains:

```text
Passenger A → 1 seat
Passenger B → 1 seat
```

Only one request may succeed.

Use the existing transaction/locking strategy.

The mobile client must never reserve seats locally.

---

# 18. Duplicate-Time Booking

If Passenger already has an active booking conflicting with the requested trip time, return a structured conflict.

Example:

```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_TIME_BOOKING",
    "message": "Unable to complete this booking.",
    "details": {
      "existingBookingId": "booking_123",
      "existingTripId": "trip_456"
    }
  }
}
```

The mobile app uses this to show a confirmation flow.

---

# 19. Booking Retrieval

```http
GET /bookings
GET /bookings/{bookingId}
```

Results are scoped to the authenticated Passenger.

Optional filters:

```text
upcoming
past
status
date
```

---

# 20. Booking Cancellation

```http
POST /bookings/{bookingId}/cancel
```

Passenger can cancel at any time before the trip starts.

Cancellation after trip start is rejected.

Cancellation must:

- update booking state
- release seats
- update availability
- process applicable payment state
- record timestamp
- record reason
- record actor

---

# 21. Payment Methods

Supported methods follow business configuration, including:

- Cash
- Vodafone Cash
- Other configured/manual wallet methods

Payment remains separate from booking state.

```text
Payment
- id
- bookingId
- method
- status
- amount
- reference
- metadata
- createdAt
- updatedAt
```

The client cannot declare a payment successful.

---

# 22. Active Trip & Live Tracking

```http
GET /me/active-trip
```

Live tracking uses the existing Firebase Realtime Database.

Target driver update frequency:

```text
approximately 15 seconds
```

Location:

```json
{
  "latitude": 29.0000,
  "longitude": 31.0000,
  "heading": 120,
  "speed": 25,
  "accuracy": 8,
  "timestamp": "..."
}
```

Firebase authorization must restrict location writes to the assigned Driver and reads to authorized trip participants/share sessions.

---

# 23. Secure Trip Sharing

Create:

```http
POST /bookings/{bookingId}/share
```

Verify:

```http
POST /public/trip-shares/{shareId}/verify
```

Recipient does not need login.

Share response:

```json
{
  "shareId": "share_123",
  "verificationCode": "482913",
  "expiresAt": "..."
}
```

Share access expires when:

- trip ends
- booking is cancelled
- share is revoked
- expiration is reached

---

# 24. QR Route Resolution

```http
GET /public/routes/{identifier}
```

Return:

- route
- origin
- destination
- ordered stations
- relevant trip information
- availability where applicable

Public route information does not require login.

Booking requires authentication.

---

# 25. Notifications

Device registration:

```http
POST /me/devices
DELETE /me/devices/{deviceId}
```

Notification center:

```http
GET /notifications
POST /notifications/{notificationId}/read
POST /notifications/read-all
```

Notifications should support deep-link data.

Passenger notifications:

- booking confirmed
- booking cancelled
- trip cancelled
- trip reminder
- relevant trip updates

Driver notifications:

- trip assignment
- trip changes
- trip cancellation
- bus assignment changes

Fleet Owner notifications:

- bus/driver changes
- relevant fleet updates

---

# 26. Common API Error Contract

All mobile APIs should use:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

Authentication errors must remain generic and must not disclose account existence or role.

Examples:

```text
AUTHENTICATION_FAILED
SESSION_EXPIRED
INVALID_REFRESH_TOKEN
ACCOUNT_SUSPENDED
ACCOUNT_DISABLED
OTP_INVALID
OTP_EXPIRED
OTP_RATE_LIMITED
```

Passenger:

```text
TRIP_NOT_FOUND
TRIP_NOT_BOOKABLE
SEATS_UNAVAILABLE
DUPLICATE_TIME_BOOKING
BOOKING_NOT_FOUND
BOOKING_NOT_CANCELLABLE
BOOKING_ALREADY_CANCELLED
TRIP_ALREADY_STARTED
INVALID_PAYMENT_METHOD
RATING_NOT_ALLOWED
```

Driver:

```text
DRIVER_NOT_ASSIGNED
TRIP_ACCESS_DENIED
INVALID_TRIP_STATE
BOOKING_NOT_ON_TRIP
INVALID_DROPOFF_STATE
PAYMENT_NOT_ALLOWED
RATING_NOT_ALLOWED
REPORT_NOT_ALLOWED
```

Fleet Owner:

```text
BUS_ACCESS_DENIED
RESOURCE_NOT_OWNED
DRIVER_ASSIGNMENT_NOT_ALLOWED
BUS_ACTION_NOT_ALLOWED
CONFLICTING_ASSIGNMENT
```

Sharing/QR:

```text
INVALID_SHARE
SHARE_EXPIRED
INVALID_SHARE_CODE
SHARE_RATE_LIMITED
INVALID_QR
ROUTE_NOT_FOUND
```
