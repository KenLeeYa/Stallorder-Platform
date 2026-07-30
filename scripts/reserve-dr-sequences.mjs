import {
  advanceTargetSequences,
  createFailoverClients,
  disconnectFailoverClients,
} from "./lib/dr-failover-operations.mjs";

let clients;
try {
  if (process.env.PRODUCTION_ENVIRONMENT_APPROVED !== "true") {
    throw new Error("PRODUCTION_ENVIRONMENT_NOT_APPROVED");
  }
  if (process.env.DR_CHANGE_CONFIRMATION !== "RESERVE_DR_SEQUENCES") {
    throw new Error("CONFIRMATION_REQUIRED_RESERVE_DR_SEQUENCES");
  }
  clients = createFailoverClients();
  const result = await advanceTargetSequences(clients.primary, clients.dr);
  console.log(JSON.stringify({
    event: "dr_sequences_reserved",
    ...result,
  }));
} catch (error) {
  console.error(JSON.stringify({
    event: "dr_sequence_reservation_failed",
    reason: error instanceof Error ? error.message : "UNKNOWN",
  }));
  process.exitCode = 1;
} finally {
  if (clients) await disconnectFailoverClients(clients);
}
