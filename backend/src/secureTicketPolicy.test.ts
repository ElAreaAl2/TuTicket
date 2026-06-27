import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveChainEventId, getTicketEventAvailabilityError, isSecureTicketEventExpired, parseSorobanU32ReturnValue } from './secureTicketPolicy';

test('derives stable u32 event ids from database event ids', () => {
  const eventId = '0230a44b-8739-4819-a5e4-bd1b377fc3a0';
  assert.equal(deriveChainEventId(eventId), deriveChainEventId(eventId));
  assert.ok(deriveChainEventId(eventId) > 0);
  assert.ok(deriveChainEventId(eventId) <= 0xffffffff);
});

test('derives different event ids for different events', () => {
  const first = deriveChainEventId('event-a');
  const second = deriveChainEventId('event-b');
  assert.notEqual(first, second);
});

test('rejects empty event ids', () => {
  assert.throws(() => deriveChainEventId(''), /eventId es requerido/);
});

test('parses Soroban u32 return values without treating zero as missing', () => {
  assert.equal(parseSorobanU32ReturnValue(0), 0);
  assert.equal(parseSorobanU32ReturnValue(42n), 42);
  assert.equal(parseSorobanU32ReturnValue('7'), 7);
  assert.equal(parseSorobanU32ReturnValue({ ok: 3 }), 3);
  assert.equal(parseSorobanU32ReturnValue({ value: 9 }), 9);
  assert.equal(parseSorobanU32ReturnValue([11]), 11);
});

test('rejects invalid Soroban u32 return values', () => {
  assert.equal(parseSorobanU32ReturnValue(-1), null);
  assert.equal(parseSorobanU32ReturnValue(0xffffffff + 1), null);
  assert.equal(parseSorobanU32ReturnValue('not-a-number'), null);
  assert.equal(parseSorobanU32ReturnValue({ error: 1 }), null);
});

test('blocks securing tickets for events that already started', () => {
  const now = new Date('2026-05-18T15:00:00.000Z');

  assert.equal(isSecureTicketEventExpired(new Date('2026-05-18T14:59:59.000Z'), now), true);
  assert.equal(isSecureTicketEventExpired(new Date('2026-05-18T15:00:00.000Z'), now), true);
  assert.equal(isSecureTicketEventExpired(new Date('2026-05-18T15:00:01.000Z'), now), false);
});

test('does not fail closed for missing or malformed event dates', () => {
  const now = new Date('2026-05-18T15:00:00.000Z');

  assert.equal(isSecureTicketEventExpired(null, now), false);
  assert.equal(isSecureTicketEventExpired(undefined, now), false);
  assert.equal(isSecureTicketEventExpired('not-a-date', now), false);
});

test('returns ticket action availability errors for closed events', () => {
  const now = new Date('2026-05-18T15:00:00.000Z');

  assert.equal(getTicketEventAvailabilityError({ status: 'PUBLISHED', startsAt: '2026-05-18T15:00:01.000Z' }, now), null);
  assert.equal(getTicketEventAvailabilityError({ status: 'PUBLISHED', startsAt: '2026-05-18T15:00:00.000Z' }, now), 'El evento ya pasó');
  assert.equal(getTicketEventAvailabilityError({ status: 'CANCELLED', startsAt: '2026-05-18T16:00:00.000Z' }, now), 'El evento fue cancelado');
  assert.equal(getTicketEventAvailabilityError({ status: 'COMPLETED', startsAt: '2026-05-18T16:00:00.000Z' }, now), 'El evento ya finalizó');
  assert.equal(getTicketEventAvailabilityError({ status: 'DRAFT', startsAt: '2026-05-18T16:00:00.000Z' }, now), 'El evento no está disponible: DRAFT');
});
