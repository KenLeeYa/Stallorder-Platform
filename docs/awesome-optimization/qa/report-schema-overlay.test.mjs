import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as reviewed from './report-schema-overlay.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = readFileSync(new URL('./report-schema-overlay.mjs', import.meta.url), 'utf8');
const currentFields = JSON.parse(/const currentFields=(\[[^;]+\]);/.exec(source)[1]);
const legacyFields = JSON.parse(/const legacyFields=(\[[^;]+\]);/.exec(source)[1]);
const schema = 'synthetic contract schema, not historical live fixture evidence';
// Exercise the unchanged strict projection algorithm against an explicitly synthetic schema pin.
// Historical schema/corpus proofs remain separate; never refresh their production helper hashes.
const fixtureSource = source
  .replace(/export const overlaySchemaSha256='[a-f0-9]+';/, `export const overlaySchemaSha256='${hash(schema)}';`)
  .replace("bytes=readFileSync('prisma/schema.prisma')", `bytes=Buffer.from(${JSON.stringify(schema)})`);
const fixture = await import(`data:text/javascript;base64,${Buffer.from(fixtureSource).toString('base64')}`);
const row = Object.fromEntries(currentFields.map(key => [key, key === 'draftVersion' ? 0 : `synthetic-${key}`]));
const original = Object.fromEntries(legacyFields.map(key => [key, row[key]]));

test('reviewed historical schema pin remains exact and rejects different bytes', () => {
  expect(reviewed.applicationOverlayVersion).toBe('report-execution-v1');
  expect(reviewed.overlaySchemaSha256).toBe('97e0328971091b3fffb67cb8abcc4ece5569348fa99278b61322297380fab901');
  const bytes = readFileSync('prisma/schema.prisma');
  if (hash(bytes) === reviewed.overlaySchemaSha256) expect(() => reviewed.assertApplicationOverlaySchema(bytes)).not.toThrow();
  else expect(() => reviewed.assertApplicationOverlaySchema(bytes)).toThrow(/SCHEMA_UNEXPECTED/);
  expect(() => reviewed.assertApplicationOverlaySchema(Buffer.from(schema))).toThrow(/SCHEMA_UNEXPECTED/);
});

test('synthetic named schema rejects byte drift and preserves every original fact', () => {
  expect(() => fixture.assertApplicationOverlaySchema()).not.toThrow();
  expect(() => fixture.assertApplicationOverlaySchema(Buffer.from(schema + '\n'))).toThrow(/SCHEMA_UNEXPECTED/);
  expect(fixture.projectLegacyApplications([row])).toEqual([original]);
  const changed = fixture.projectLegacyApplications([{ ...row, merchantName: 'changed original fact' }]);
  expect(changed).not.toEqual([original]);
  expect(changed[0].merchantName).toBe('changed original fact');
});

test('synthetic projection rejects default, unknown, missing and reordered fields', () => {
  expect(() => fixture.projectLegacyApplications([{ ...row, draftVersion: 1 }])).toThrow(/DEFAULT_DRIFT/);
  expect(() => fixture.projectLegacyApplications([{ ...row, unknownColumn: true }])).toThrow(/SCHEMA_UNEXPECTED/);
  const missing = { ...row }; delete missing.merchantName;
  expect(() => fixture.projectLegacyApplications([missing])).toThrow(/SCHEMA_UNEXPECTED/);
  expect(() => fixture.projectLegacyApplications([Object.fromEntries(Object.entries(row).reverse())])).toThrow(/SCHEMA_UNEXPECTED/);
});
