import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Read-only GitHub protection readback. Absence or API denial never authorizes a mutation. */
export async function assertPreviewApproval(environment, request = fetch) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(environment.GITHUB_REPOSITORY ?? "") || !environment.GH_TOKEN?.trim()) throw new Error("PREVIEW_APPROVAL_INPUT_MISSING");
  let configuration;
  try {
    const response = await request(`https://api.github.com/repos/${environment.GITHUB_REPOSITORY}/environments/Preview`, {
      headers: { Authorization: `Bearer ${environment.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("API_DENIED");
    configuration = await response.json();
  } catch { throw new Error("PREVIEW_APPROVAL_READ_FAILED"); }
  const rules = configuration?.protection_rules;
  const approval = Array.isArray(rules) ? rules.filter((rule) => rule?.type === "required_reviewers") : [];
  if (configuration?.name !== "Preview" || approval.length !== 1 || !Array.isArray(approval[0].reviewers) || !approval[0].reviewers.length
    || approval[0].reviewers.some((entry) => !["User", "Team"].includes(entry?.type) || !Number.isInteger(entry.reviewer?.id) || entry.reviewer.id < 1)) throw new Error("PREVIEW_APPROVAL_RULE_MISSING_OR_INVALID");
  return { status: "PRESENT", reviewerCount: approval[0].reviewers.length, environment: "Preview" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertPreviewApproval(process.env).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
