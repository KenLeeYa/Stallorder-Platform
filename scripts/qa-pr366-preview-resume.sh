#!/usr/bin/env bash
set -euo pipefail
# Reuse the original owned pair only; never create, migrate or deploy resources.
root="$PWD"
node scripts/pr366-preview-resume-source.mjs prepare
original_sha="$(jq -r '.recoverySource.headSha' .preview-receipt/manual-resources.json)"
original_dir="$(mktemp -d)"
git worktree add --detach "$original_dir" "$original_sha" >/dev/null
resume_cleanup() {
  [ -z "${PR366_PRIVATE_FIXTURE_DIR:-}" ] || rm -rf "$PR366_PRIVATE_FIXTURE_DIR"
  cd "$root"
  git worktree remove --force "$original_dir" >/dev/null
}
trap resume_cleanup EXIT
node scripts/pr366-preview-resume-source.mjs verify "$original_dir"
ln -s "$root/node_modules" "$original_dir/node_modules"
ln -s "$root/.preview-receipt" "$original_dir/.preview-receipt"
for file in qa-pr366-preview-ui.mjs qa-pr366-preview-db-fixtures.mjs preview-harness-preflight.mjs; do cp "$root/scripts/$file" "$original_dir/scripts/$file"; done
config="$(supabase branches get "$PREVIEW_BRANCH_NAME" --project-ref "$SUPABASE_PARENT_PROJECT_REF" --output json --log-level error)"
raw_url="$(jq -r '.POSTGRES_URL' <<<"$config")"
for value in "$(jq -r '.SUPABASE_ANON_KEY' <<<"$config")" "$(jq -r '.SUPABASE_SERVICE_ROLE_KEY // empty' <<<"$config")" "$raw_url"; do [ -z "$value" ] || echo "::add-mask::$value"; done
PR366_CHILD_DATABASE_URL="$raw_url"
export PR366_CHILD_DATABASE_URL
PR366_CHILD_REF="$(jq -r '.branches[0].id' .preview-receipt/manual-resources.json)"
PR366_DEPLOYMENT_ID="$(jq -r '.deployments[0].id' .preview-receipt/manual-resources.json)"
export PR366_CHILD_REF PR366_DEPLOYMENT_ID
cd "$original_dir"
PR366_CHILD_DATABASE_URL="$(node -e 'try { const u = new URL(process.env.PR366_CHILD_DATABASE_URL); u.searchParams.set("sslmode", "require"); process.stdout.write(u.href); } catch { process.stderr.write("PR366_DATABASE_URL_INVALID"); process.exit(1); }')"
export PR366_CHILD_DATABASE_URL
PR366_PRIVATE_FIXTURE_DIR="$(mktemp -d)"
chmod 700 "$PR366_PRIVATE_FIXTURE_DIR"
export PR366_PRIVATE_FIXTURE_DIR
trap resume_cleanup EXIT
node -e 'require("node:fs").writeFileSync(".preview-receipt/ui-selection.json", JSON.stringify({childRef:process.env.PR366_CHILD_REF,deploymentId:process.env.PR366_DEPLOYMENT_ID}), {flag:"wx"})'
node scripts/qa-pr366-preview-binding.mjs capture-binding .preview-receipt/manual-resources.json .preview-receipt/ui-selection.json .preview-receipt/primary-baseline.json .preview-receipt/ui-binding.json
preview_origin="$(node -e 'const b=JSON.parse(require("node:fs").readFileSync(".preview-receipt/ui-binding.json","utf8")); process.stdout.write(new URL(b.origin).origin);')"
supabase secrets set --project-ref "$PR366_CHILD_REF" "PUBLIC_APP_ORIGINS=$preview_origin" "TRUSTED_CLIENT_IP_HEADER=x-real-ip" > /dev/null
node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui catalog-descriptor
for operation in enable-supply dense-schedule dense-workforce dense-supply synthetic-invoices inbox inbox-membership; do
  node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui "$operation"
done
node -e 'const fs = require("node:fs"); const p = ".preview-receipt/ui-binding.json"; const b = JSON.parse(fs.readFileSync(p,"utf8")); const load = name => JSON.parse(fs.readFileSync(`.preview-receipt/pr366-ui/fixture-${name}.json`,"utf8")); b.fixtures = {catalogProduct:load("catalog-descriptor"),schedule:load("dense-schedule"),workforce:load("dense-workforce"),supply:load("dense-supply"),invoices:load("synthetic-invoices"),inbox:load("inbox"),membership:load("inbox-membership")}; b.fixtureActions = {prepareDenseExpenses:true}; fs.writeFileSync(p,JSON.stringify(b,null,2));'
for operation in prepare-ordering prepare-pos-product; do
  node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui "$operation"
done
node scripts/qa-pr366-preview-ui.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui prepare-cash-shift
node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui pos-descriptor
node -e 'const fs=require("node:fs"); const p=".preview-receipt/ui-binding.json"; const b=JSON.parse(fs.readFileSync(p,"utf8")); b.fixtures.pos=JSON.parse(fs.readFileSync(".preview-receipt/pr366-ui/fixture-pos-descriptor.json","utf8")); fs.writeFileSync(p,JSON.stringify(b,null,2));'
node scripts/qa-pr366-preview-ui.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui
node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui inbox-readback .preview-receipt/pr366-ui/fixture-inbox.json
node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui inbox-membership-readback .preview-receipt/pr366-ui/inbox-membership-revoked.json
for operation in enable-circuit-b public-qr open-hours; do
  node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui "$operation"
done
refresh_binding() {
  node scripts/qa-pr366-preview-binding.mjs capture-binding .preview-receipt/manual-resources.json .preview-receipt/ui-selection.json .preview-receipt/primary-baseline.json ".preview-receipt/ui-binding-$1.json"
  node -e 'const fs=require("node:fs"); const p=".preview-receipt/ui-binding.json"; const old=JSON.parse(fs.readFileSync(p,"utf8")); const fresh=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); fresh.fixtures=old.fixtures; fresh.fixtureActions=old.fixtureActions; fresh.fixtures.hours=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); fs.writeFileSync(p,JSON.stringify(fresh,null,2));' ".preview-receipt/ui-binding-$1.json" ".preview-receipt/pr366-ui/fixture-$1-hours.json"
}
refresh_binding open
node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui midnight-rollback
node scripts/qa-pr366-preview-ui.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui hours-open
node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui closed-hours
refresh_binding closed
node scripts/qa-pr366-preview-ui.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui hours-closed
node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui verify-rejected-orders .preview-receipt/pr366-ui/ui-hours-closed.json
node -e 'const fs=require("node:fs"); const load=phase=>JSON.parse(fs.readFileSync(`.preview-receipt/pr366-ui/fixture-${phase}-hours.json`,"utf8")); const open=load("open"),closed=load("closed"); if(JSON.stringify(open.after)!==JSON.stringify(closed.before)) throw Error("HOURS_PHASE_CHAIN_CHANGED"); fs.writeFileSync(".preview-receipt/pr366-ui/fixture-original-hours.json",JSON.stringify({...closed,before:open.before}),{flag:"wx"});'
node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui restore-hours .preview-receipt/pr366-ui/fixture-original-hours.json
node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui overnight-hours
refresh_binding overnight
node scripts/qa-pr366-preview-ui.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui hours-overnight
node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui cutoff-hours
refresh_binding cutoff
node scripts/qa-pr366-preview-ui.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui hours-cutoff
node -e 'const fs=require("node:fs"); const load=phase=>JSON.parse(fs.readFileSync(`.preview-receipt/pr366-ui/fixture-${phase}-hours.json`,"utf8")); const overnight=load("overnight"),cutoff=load("cutoff"); if(JSON.stringify(overnight.after)!==JSON.stringify(cutoff.before)) throw Error("HOURS_PHASE_CHAIN_CHANGED"); fs.writeFileSync(".preview-receipt/pr366-ui/fixture-calendar-original-hours.json",JSON.stringify({...cutoff,before:overnight.before}),{flag:"wx"});'
node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui restore-hours .preview-receipt/pr366-ui/fixture-calendar-original-hours.json
for operation in ordering supply; do
  fixture_operation="enable-$operation"
  if [ "$operation" = ordering ]; then fixture_operation=prepare-ordering; fi
  node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui "restore-$operation" ".preview-receipt/pr366-ui/fixture-$fixture_operation.json"
done
node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui prepare-preorder
node scripts/qa-pr366-preview-binding.mjs capture-binding .preview-receipt/manual-resources.json .preview-receipt/ui-selection.json .preview-receipt/primary-baseline.json .preview-receipt/ui-binding-preorder.json
node -e 'const fs=require("node:fs"); const p=".preview-receipt/ui-binding.json"; const old=JSON.parse(fs.readFileSync(p,"utf8")); const fresh=JSON.parse(fs.readFileSync(".preview-receipt/ui-binding-preorder.json","utf8")); fresh.fixtures={...old.fixtures,preorder:JSON.parse(fs.readFileSync(".preview-receipt/pr366-ui/fixture-prepare-preorder.json","utf8"))}; fs.writeFileSync(p,JSON.stringify(fresh,null,2));'
node scripts/qa-pr366-preview-ui.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui hours-preorder
node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui restore-preorder .preview-receipt/pr366-ui/fixture-prepare-preorder.json
node scripts/qa-pr366-preview-db-fixtures.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui restore-circuit-b .preview-receipt/pr366-ui/fixture-enable-circuit-b.json
