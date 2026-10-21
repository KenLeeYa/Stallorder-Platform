// Historical first-stage helper only. The retained receipt used the then-current pre-schema guard.
// These final bytes are not a reusable migration recipe; reject before imports, Prisma or network.
throw new Error("BATCH3_HISTORICAL_MIGRATION_HELPER_NON_REUSABLE");
