# API Contract: Super Admin Payment Management

**Base Path**: `/admin/bookings/:id/payment`  
**Security**: Bearer JWT (`app_role: 'super_admin'`)  
**Guard**: `@Platform()`  
**Response Format**: `{ statusCode: number, data: T }`  

---

## 1. Verify Offline / Wallet Payment

Confirms receipt of funds for an offline or mobile wallet transaction (e.g. Vodafone Cash, InstaPay, manual wallet).

- **Method**: `POST`
- **Path**: `/admin/bookings/:id/payment/verify`

### Request Body

```json
{
  "reference": "VF-9021849",
  "amount": 100.00,
  "paymentMethod": "VODAFONE_CASH",
  "notes": "Transfer confirmed in Vodafone Cash merchant account"
}
```

### Validation Rules

- `reference`: String, 1–100 characters, required.
- `amount`: Number, positive, required. **Must strictly equal booking `totalAmount`** (Clarification Q2); otherwise rejected with `400 Bad Request`.
- `paymentMethod`: String, optional (defaults to existing booking `paymentMethod`).
- `notes`: String, up to 500 characters, optional.

### Response (200 OK)

```json
{
  "statusCode": 200,
  "data": {
    "bookingId": "c7a8e2b1-5f3d-4c8e-9b2a-1f0e8d7c6b5a",
    "paymentStatus": "PAID",
    "paymentMethod": "VODAFONE_CASH",
    "paymentReference": "VF-9021849",
    "paidAt": "2026-09-14T07:20:00.000Z",
    "paymentMarkedBy": "u0-admin-super"
  }
}
```

### Errors

- `400 Bad Request`: `PAYMENT_AMOUNT_MISMATCH` if `amount !== booking.totalAmount`.
- `409 Conflict`: `PAYMENT_ALREADY_SETTLED` if payment is already `PAID` or `REFUNDED`.

---

## 2. Process Full or Partial Refund

Processes a refund for a cancelled booking or administrative dispute, supporting cumulative partial refunds (Clarification Q1).

- **Method**: `POST`
- **Path**: `/admin/bookings/:id/payment/refund`

### Request Body

```json
{
  "refundReference": "REF-VF-10928",
  "refundAmount": 50.00,
  "reason": "Customer cancelled 1 of 2 seats before departure",
  "notes": "Vodafone Cash refund transferred back to passenger mobile"
}
```

### Validation Rules

- `refundReference`: String, 1–100 characters, required.
- `refundAmount`: Number, positive, required. Must satisfy:
  $$\text{refundAmount} \le (\text{booking.totalAmount} - \text{booking.refundedAmount})$$
- `reason`: String, 1–500 characters, required.
- `notes`: String, up to 500 characters, optional.

### State Transitions

- If cumulative $(\text{refundedAmount} + \text{newRefundAmount}) = \text{totalAmount}$:
  `paymentStatus` becomes `REFUNDED`.
- If cumulative $(\text{refundedAmount} + \text{newRefundAmount}) < \text{totalAmount}$:
  `paymentStatus` becomes `PARTIALLY_REFUNDED`.

### Response (200 OK)

```json
{
  "statusCode": 200,
  "data": {
    "bookingId": "c7a8e2b1-5f3d-4c8e-9b2a-1f0e8d7c6b5a",
    "paymentStatus": "PARTIALLY_REFUNDED",
    "totalAmount": "100.00",
    "refundedAmount": "50.00",
    "remainingRefundableBalance": "50.00",
    "refundReference": "REF-VF-10928",
    "updatedAt": "2026-09-14T08:00:00.000Z"
  }
}
```

### Errors

- `400 Bad Request`: `REFUND_EXCEEDS_BALANCE` if `refundAmount > (totalAmount - refundedAmount)`.
- `400 Bad Request`: `REFUND_NOT_ELIGIBLE` if booking was unpaid cash.

---

## 3. Mark Payment Failed / Cancelled

Records a failed or fraudulent payment verification attempt.

- **Method**: `POST`
- **Path**: `/admin/bookings/:id/payment/fail`

### Request Body

```json
{
  "reason": "External wallet transaction reference could not be verified in merchant statements",
  "notes": "Passenger contacted via phone; admitted transfer was not completed."
}
```

### Response (200 OK)

```json
{
  "statusCode": 200,
  "data": {
    "bookingId": "c7a8e2b1-5f3d-4c8e-9b2a-1f0e8d7c6b5a",
    "paymentStatus": "FAILED",
    "updatedAt": "2026-09-14T08:15:00.000Z"
  }
}
```
