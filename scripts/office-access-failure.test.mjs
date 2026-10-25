import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyOfficeAccessFailure } from '../artifacts/technical-office/src/lib/office-access-failure.ts';

test('only an explicit invitation rejection displays the invitation screen', () => {
  assert.equal(classifyOfficeAccessFailure({ status: 403, data: { error: 'An active invitation for this verified email is required.' } }).kind, 'invitation');
  assert.equal(classifyOfficeAccessFailure({ status: 403, data: { code: 'INVITATION_REQUIRED' } }).kind, 'invitation');
  assert.equal(classifyOfficeAccessFailure({ status: 403 }).kind, 'verification');
});

test('service and network failures never claim a missing invitation or expose internals', () => {
  for (const error of [{ status: 500, data: { error: 'private database diagnostic' } }, { status: 503 }, new TypeError('private network diagnostic')]) {
    const failure = classifyOfficeAccessFailure(error);
    assert.equal(failure.kind, 'service');
    assert(!JSON.stringify(failure).includes('private'));
  }
});

test('session and duplicate identity failures have distinct safe explanations', () => {
  assert.equal(classifyOfficeAccessFailure({ status: 401 }).kind, 'session');
  assert.equal(classifyOfficeAccessFailure({ status: 409, data: { code: 'OFFICE_IDENTITY_CONFLICT' } }).kind, 'conflict');
  assert.equal(classifyOfficeAccessFailure({ status: 409 }).kind, 'service');
});
