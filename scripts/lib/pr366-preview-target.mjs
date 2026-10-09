// A coordinator-produced provider readback is required; never infer a child from a URL.
export function assertTarget(receipt, binding, now = Date.now()) {
  const url = new URL(binding.origin);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app') || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash || !/^manual-[1-9]\d*$/.test(receipt.resourceKey)
    || receipt.parent !== 'eyuctbnlvnbnivwasvqr' || receipt.project !== 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP'
    || receipt.team !== 'team_MMfsiG94K9Zy3e6w7Ccc9xY4' || receipt.gitBranch !== 'codex/integrated-production-20261002'
    || !(Date.parse(receipt.expiresAt) > now) || receipt.status !== 'CAPTURED'
    || binding.resourceKey !== receipt.resourceKey || binding.providerReadback !== 'VERIFIED'
    || !/^[a-f0-9]{40}$/.test(binding.sha ?? '') || !/^[a-f0-9]{40}$/.test(binding.tree ?? '')
    || !receipt.branches?.some(row => row.id === binding.childRef && row.id !== receipt.parent && !row.absent)
    || !receipt.deployments?.some(row => row.id === binding.deploymentId && row.target === 'preview' && !row.absent)
    || binding.productionAlias !== false || binding.dataLess !== true) throw Error('PREVIEW_UI_TARGET_DENIED');
  const proof = binding.readback;
  if (!proof || !(Date.parse(proof.verifiedAt) <= now && Date.parse(proof.verifiedAt) > now - 15 * 60_000)
    || proof.child?.project_ref !== binding.childRef || proof.child?.name !== receipt.resourceKey
    || (proof.child?.parent_project_ref !== undefined && proof.child.parent_project_ref !== receipt.parent)
    || proof.childScope?.provider !== 'supabase-cli' || proof.childScope?.operation !== 'branches list'
    || proof.childScope?.parentProjectRef !== receipt.parent || proof.child?.with_data !== false
    || proof.child?.git_branch !== receipt.gitBranch || proof.deployment?.id !== binding.deploymentId
    || proof.deployment?.projectId !== receipt.project || proof.deployment?.teamId !== receipt.team
    || proof.deployment?.target !== 'preview' || proof.deployment?.origin !== url.origin
    || proof.deployment?.meta?.stallorderPreviewResource !== receipt.resourceKey
    || proof.deployment?.meta?.githubCommitRef !== receipt.gitBranch
    || proof.deployment?.meta?.githubCommitSha !== binding.sha
    || proof.source?.sha !== binding.sha || proof.source?.tree !== binding.tree) throw Error('PREVIEW_UI_READBACK_DENIED');
  return url.origin;
}
