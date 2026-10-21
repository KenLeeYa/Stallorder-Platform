import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateHeaderValue } from 'node:http';

// Presence checks only: never log values or infer permission from an old receipt.
export function assertHostedSettings(env) {
  const required = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PARENT_PROJECT_REF', 'VERCEL_TOKEN',
    'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID', 'PREVIEW_BYPASS_SECRET'];
  if (required.some(key => typeof env[key] !== 'string' || !env[key].trim())) throw Error('PREVIEW_SETTINGS_INCOMPLETE');
  try { validateHeaderValue('x-vercel-protection-bypass', env.PREVIEW_BYPASS_SECRET.trim()); }
  catch { throw Error('PREVIEW_BYPASS_HEADER_INVALID'); }
  return { status: 'SETTINGS_PRESENT', locale: 'zh-TW' };
}

export function captureDeployment(payload) {
  try {
    const row = payload?.deployment ?? payload;
    if (!/^dpl_[A-Za-z0-9]+$/.test(row?.id ?? '') || typeof row?.url !== 'string') throw Error();
    const url = new URL(row.url.startsWith('https://') ? row.url : `https://${row.url}`);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname)
      || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw Error();
    return { id: row.id, url: url.origin };
  } catch { throw Error('PREVIEW_DEPLOYMENT_CAPTURE_INVALID'); }
}

export function assertCashShift(shift, resourceKey) {
  if (!shift || !/^manual-[1-9]\d*$/.test(resourceKey)
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(shift.id ?? '')
    || shift.status !== 'OPEN' || shift.openingAmount !== 1000
    || shift.organizationId !== '11111111-1111-4111-8111-111111111111'
    || shift.stallId !== '22222222-2222-4222-8222-222222222222'
    || shift.openedById !== '55555555-5555-4555-8555-555555555552'
    || shift.note !== `PR366 ${resourceKey} isolated shift`) throw Error('PREVIEW_CASH_SHIFT_READBACK_INVALID');
  return shift.id;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let result;
    if (process.argv[2] === 'settings' && process.argv.length === 3) result = assertHostedSettings(process.env);
    else if (process.argv[2] === 'deployment' && process.argv.length === 3) result = captureDeployment(JSON.parse(readFileSync(0, 'utf8')));
    else throw Error('PREVIEW_PREFLIGHT_ARGUMENTS_INVALID');
    console.log(JSON.stringify(result));
  } catch (error) {
    const codes = ['PREVIEW_SETTINGS_INCOMPLETE', 'PREVIEW_BYPASS_HEADER_INVALID', 'PREVIEW_DEPLOYMENT_CAPTURE_INVALID', 'PREVIEW_PREFLIGHT_ARGUMENTS_INVALID'];
    console.error(codes.includes(error.message) ? error.message : 'PREVIEW_PREFLIGHT_FAILED');
    process.exitCode = 1;
  }
}
