import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeSingleEventDeploy } from './deployEventPolicy';

test('allows deploy for an event without contract', () => {
  assert.deepEqual(authorizeSingleEventDeploy({
    event: { id: 'event-1', contract_address: null },
  }), { ok: true });
});

test('allows deploy even when the event already has Web2 tickets', () => {
  assert.deepEqual(authorizeSingleEventDeploy({
    event: { id: 'event-1', contract_address: null },
  }), { ok: true });
});

test('rejects deploy for unknown events', () => {
  assert.deepEqual(authorizeSingleEventDeploy({
    event: null,
  }), { ok: false, status: 404, error: 'Evento no encontrado' });
});

test('rejects deploy for events that already have a contract', () => {
  assert.deepEqual(authorizeSingleEventDeploy({
    event: { id: 'event-1', contract_address: 'CCONTRACT' },
  }), { ok: false, status: 409, error: 'El evento ya tiene contrato' });
});
