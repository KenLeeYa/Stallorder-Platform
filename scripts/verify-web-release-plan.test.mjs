import { expect, test } from 'vitest';
import { verifyWebReleasePlan } from './verify-web-release-plan.mjs';
const receipt = () => ({ status: 'PASS', scope: 'WEB_KNOWN_NATIVE_DEPENDENCY_EXCLUSION', npmVersion: '11.16.0',
  selector: 'npm ci --workspace packages/contracts --include-workspace-root --include=dev',
  head: 'a'.repeat(40), tree: 'b'.repeat(40), sourceSha256: 'c'.repeat(64), lockSha256: 'd'.repeat(64),
  installedGraphSha256: 'e'.repeat(64), verifierSha256: 'f'.repeat(64), artifactSha256: '1'.repeat(64),
  buildId: 'fresh-build', runtimeLoaderSafety: 'NOT_PROVEN', deployment: 'NOT_DEPLOYED' });
test('binds source and installation while allowing separately validated build IDs', () => {
  expect(verifyWebReleasePlan({ ...receipt(), buildId: 'plan' }, { ...receipt(), buildId: 'apply' }).status).toBe('PASS');
});
test.each(['head', 'tree', 'sourceSha256', 'lockSha256', 'installedGraphSha256', 'verifierSha256'])('rejects changed %s', key => {
  expect(() => verifyWebReleasePlan(receipt(), { ...receipt(), [key]: '0'.repeat(receipt()[key].length) })).toThrow('BINDING_MISMATCH');
});
test.each(['status', 'scope', 'npmVersion', 'selector'])('rejects invalid %s', key => {
  expect(() => verifyWebReleasePlan(receipt(), { ...receipt(), [key]: 'INVALID' })).toThrow('SCOPE_INVALID');
});
test('rejects missing or malformed fingerprints', () => {
  expect(() => verifyWebReleasePlan({ ...receipt(), sourceSha256: undefined }, receipt())).toThrow('BINDING_MISMATCH');
});
test.each(['artifactSha256', 'buildId', 'runtimeLoaderSafety', 'deployment'])('rejects missing artifact scope evidence %s', key => {
  expect(() => verifyWebReleasePlan(receipt(), { ...receipt(), [key]: undefined })).toThrow('SCOPE_INVALID');
});
