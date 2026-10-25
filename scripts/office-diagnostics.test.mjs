import assert from 'node:assert/strict';
import test from 'node:test';
import { officeProfileFailure } from '../artifacts/api-server/src/lib/officeProfileFailure.ts';
import { isOfficeSchemaReady } from '../artifacts/api-server/src/lib/schemaReadiness.ts';
import { classifyOfficeAccessFailure } from '../artifacts/technical-office/src/lib/office-access-failure.ts';

test('nested database errors produce safe schema/unavailable codes without SQL or parameters', () => {
  const schema = officeProfileFailure({ cause: { code: '42P01', query: 'private query', params: ['private email'] } });
  assert.equal(schema.status, 503);
  assert.equal(schema.code, 'OFFICE_DATABASE_SCHEMA_MISSING');
  assert(!JSON.stringify(schema).includes('private'));
  assert.equal(officeProfileFailure({ cause: { code: '42703' } }).code, 'OFFICE_DATABASE_SCHEMA_MISSING');
  assert.equal(officeProfileFailure({ cause: { code: '28P01' } }).code, 'OFFICE_DATABASE_UNAVAILABLE');
  assert.equal(officeProfileFailure({ status: 429 }).code, 'AUTH_PROVIDER_UNAVAILABLE');
  assert.equal(officeProfileFailure(new Error('private diagnostic')).code, 'OFFICE_PROFILE_SYNC_FAILED');
});

test('readiness detects missing tables and columns using metadata only', () => {
  const expected = { members: ['id', 'email'], tasks: ['id'] };
  assert.equal(isOfficeSchemaReady(expected, []), false);
  const members = [{ table_name: 'members', column_name: 'id' }, { table_name: 'members', column_name: 'email' }];
  assert.equal(isOfficeSchemaReady(expected, members), false);
  const complete = [...members, { table_name: 'tasks', column_name: 'id' }];
  assert.equal(isOfficeSchemaReady(expected, complete), true);
  assert.equal(isOfficeSchemaReady(expected, complete.filter(row => row.column_name !== 'email')), false);
});

test('database failures never render as invitation rejection', () => {
  for (const code of ['OFFICE_DATABASE_SCHEMA_MISSING', 'OFFICE_DATABASE_UNAVAILABLE']) {
    const issue = classifyOfficeAccessFailure({ status: 503, data: { code } });
    assert.equal(issue.kind, 'service');
    assert(!issue.title.includes('دعوة'));
  }
});
