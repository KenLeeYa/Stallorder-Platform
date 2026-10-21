export { reportProviderBinding } from './mock-report-email.mjs';
export async function sendReportEnvelope() {
  process.send?.({ kind: 'AFTER_EFFECT_GRANT', pid: process.pid });
  await new Promise<never>(() => { setInterval(() => {}, 1000); });
}
