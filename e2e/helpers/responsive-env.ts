import { loadEnvFile } from "node:process";
import { assertResponsiveQaTarget } from "../../scripts/responsive-qa-target.mjs";

// This dependency must evaluate before the baseline config loads fallback defaults.
loadEnvFile(".env.local");
assertResponsiveQaTarget(process.env);
