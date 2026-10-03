import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';
function auditMutations(source, path) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true); const mutations = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ['delete', 'deleteMany', 'update', 'updateMany', 'upsert'].includes(node.expression.name.text)
      && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === 'auditLog') mutations.push(node.expression.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast); return mutations;
}
function files(directory) { return readdirSync(directory, { withFileTypes: true }).flatMap(row => row.isDirectory() ? files(join(directory, row.name)) : row.name.endsWith('.ts') ? [join(directory, row.name)] : []); }
test('E2E never deletes or updates committed audit evidence during fixture cleanup', () => {
  const violations = files('e2e').flatMap(path => auditMutations(readFileSync(path, 'utf8'), path).map(operation => ({ path, operation })));
  expect(violations).toEqual([]);
});
test('immutable cleanup regression catches destructive nested transaction operations, not audit reads or inserts', () => {
  expect(auditMutations('await prisma.$transaction([prisma.auditLog.deleteMany({where:{entityId:id}})]);', 'negative.ts')).toEqual(['prisma.auditLog.deleteMany']);
  expect(auditMutations('await prisma.auditLog.update({}); await prisma.auditLog.findMany({}); await prisma.auditLog.create({});', 'negative.ts')).toEqual(['prisma.auditLog.update']);
});

const ownedCleanupFiles = ['capacity-refresh-concurrency', 'targeted-stall-schedule-concurrency', 'cds-pickup-display', 'merchant-application-reapplication', 'staff-kds-print-closure-flow', 'p1-operational-tools', 'platform-admin-google-login'];
function unprotectedAuditOwnerDeletes(source, path) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), violations = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ['delete', 'deleteMany'].includes(node.expression.name.text)
      && ts.isPropertyAccessExpression(node.expression.expression)
      && ['organization', 'stall', 'profile'].includes(node.expression.expression.name.text)) {
      const argument = node.arguments[0]?.getText(ast) ?? '';
      if (!/auditLogs\s*:\s*\{\s*none\s*:\s*\{\s*\}\s*\}/.test(argument)) violations.push(node.expression.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); return violations;
}
test('cleanup preserves audit owners rather than triggering FK cascade or SET NULL on committed evidence', () => {
  expect(ownedCleanupFiles.flatMap(name => { const path = `e2e/${name}.spec.ts`; return unprotectedAuditOwnerDeletes(readFileSync(path, 'utf8'), path).map(operation => ({ path, operation })); })).toEqual([]);
});
test('audit-owner deletion requires no audit rows, not just an exact fixture ID', () => {
  expect(unprotectedAuditOwnerDeletes('await prisma.profile.deleteMany({where:{id:fixtureId}});', 'negative.ts')).toEqual(['prisma.profile.deleteMany']);
  expect(unprotectedAuditOwnerDeletes('await prisma.profile.deleteMany({where:{id:fixtureId,auditLogs:{none:{}}}});', 'safe.ts')).toEqual([]);
});
