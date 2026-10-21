import assert from 'node:assert/strict';
export const legacyNotificationColumns = ["id","organization_id","stall_id","integration_id","contact_link_id","order_id","provider","template_code","recipient_reference","status","attempt_count","next_attempt_at","last_error_code","provider_message_id","sent_at","created_at","updated_at","event_version","delivery_mode","environment","recipient_identity_hash","template_version","snapshot_ciphertext","payload_hash","retry_key","first_request_at","lease_token","lease_expires_at","outcome","provider_accepted_request_id","manual_retry_count","last_manual_retry_at"];
export function projectOriginalNotificationJobs(rows) {
  return rows.map(row => {
    assert.deepEqual(Object.keys(row), [...legacyNotificationColumns, 'legacy_intent_json'], 'LEGACY_SCHEMA_COLUMNS_UNEXPECTED');
    assert.equal(row.legacy_intent_json, null, 'LEGACY_HISTORICAL_INTENT_CHANGED');
    return Object.fromEntries(legacyNotificationColumns.map(key => [key, row[key]]));
  });
}
