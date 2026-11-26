import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const repo = 'KenLeeYa/Stallorder-Platform';
const bot = 'github-actions[bot]';
const sameTitle = title => title.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

function publicText(text, max) {
  return typeof text === 'string' && text.trim().length > 0 && text.length <= max &&
    !/[\p{Cc}<>]/u.test(text);
}

export function reconcile(item, tickets, comments = []) {
  const { key, title, evidence, revision, acceptance, risk, tracking } = item;
  if (typeof key !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(key) || key.length > 90 ||
      !publicText(title, 160) || !publicText(acceptance, 1200) ||
      typeof revision !== 'string' || !/^[0-9a-f]{40}$/.test(revision) ||
      !['standard', 'sensitive'].includes(risk) ||
      (tracking !== undefined && !(Number.isSafeInteger(tracking) && tracking > 0))) {
    throw new Error('Invalid finding fields');
  }
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 12) throw new Error('Missing or excessive evidence');
  const urls = [...new Set(evidence.map(value => {
    if (!publicText(value, 550)) throw new Error('Invalid evidence URL');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search) throw new Error('Use public HTTPS evidence without credentials or query parameters');
    return url.href;
  }))].sort();
  const keyMarker = '<!-- qidaigo-weekly:' + key + ' -->';
  const note = [title, 'Revision: ' + revision, 'Risk: ' + risk, 'Acceptance: ' + acceptance, ...urls].join('\n\n');
  const digest = createHash('sha256').update(note).digest('hex');
  const evidenceMarker = '<!-- qidaigo-evidence:' + digest + ' -->';
  const body = note + '\n\n' + evidenceMarker;
  const matching = tickets.filter(t => !t.pull_request && t.user.login === bot && t.body?.startsWith(keyMarker + '\n'));
  if (matching.length > 1) return {action:'review', reason:'Conflicting intake keys', numbers:matching.map(t => t.number)};
  if (tracking !== undefined) {
    const ticket = tickets.find(t => t.number === tracking);
    if (!ticket || (matching.length && matching[0].number !== tracking)) return {action:'review', reason:'Tracking reference conflicts or is missing'};
    return {action:'tracked', number:tracking, state:ticket.state, kind:ticket.pull_request ? 'PR' : 'Issue'};
  }
  if (matching.length) {
    const ticket = matching[0];
    if (ticket.state !== 'open') return {action:'review', number:ticket.number, reason:'Previously closed'};
    const recorded = ticket.body.includes(evidenceMarker) || comments.some(c => c.user.login === bot && c.body?.includes(evidenceMarker));
    return {action:recorded ? 'unchanged' : 'update', number:ticket.number, body};
  }
  const similar = tickets.filter(t => sameTitle(t.title) === sameTitle(title));
  if (similar.length) return {action:'review', reason:'Title already tracked', numbers:similar.map(t => t.number)};
  return {action:'create', body:keyMarker + '\n\n' + body};
}

function github(path, payload) {
  const args = ['api', 'repos/' + repo + '/' + path];
  if (payload) args.push('--method', 'POST', '--input', '-');
  return JSON.parse(execFileSync('gh', args, {
    input:payload && JSON.stringify(payload), encoding:'utf8', maxBuffer:32 * 1024 * 1024,
  }));
}

function list(path) {
  const rows = [];
  for (let page = 1; ; page++) {
    const batch = github(path + '&per_page=100&page=' + page);
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
}

export function nextTicket(tickets, readComments) {
  for (const ticket of tickets) {
    if (ticket.pull_request || ticket.user.login !== bot || !ticket.body?.startsWith('<!-- qidaigo-weekly:') ||
        !ticket.body.includes('\n\nRisk: standard\n\n') ||
        ticket.labels.some(label => label.name === 'codex-in-progress')) continue;
    const comments = ticket.comments ? readComments(ticket.number) : [];
    if (comments.some(c => c.user.login === bot && c.body?.includes('\n\nRisk: sensitive\n\n'))) continue;
    return ticket;
  }
  return null;
}

function reviewQueue() {
  const tickets = list('issues?state=open&labels=codex-ready&sort=created&direction=asc');
  const next = nextTicket(tickets, number => list('issues/' + number + '/comments?direction=asc'));
  console.log(JSON.stringify(next ? {number:next.number, url:next.html_url, title:next.title} : {number:null}));
}

function pullFeedback(number) {
  const fields = 'state,baseRefName,headRefOid,mergeCommit,statusCheckRollup';
  const json = execFileSync('gh', ['pr', 'view', String(number), '--repo', repo, '--json', fields], {encoding:'utf8'});
  const pr = JSON.parse(json);
  return {
    state:pr.state, base:pr.baseRefName, head:pr.headRefOid, merge:pr.mergeCommit?.oid ?? null,
    checks:pr.statusCheckRollup.map(check => ({
      workflow:check.workflowName ?? null, name:check.name ?? check.context,
      status:check.conclusion || check.status || check.state, url:check.detailsUrl || check.targetUrl,
    })),
  };
}

function run() {
  if (process.argv.length === 3 && process.argv[2] === 'queue') return reviewQueue();
  const [file, mode = 'plan', ...extra] = process.argv.slice(2);
  if (!file || extra.length || !['plan','apply'].includes(mode)) throw new Error('Usage: node scripts/weekly-report.mjs <JSON file or -> [plan|apply]');
  if (mode === 'apply' && !(process.env.GITHUB_ACTIONS === 'true' &&
      process.env.GITHUB_REPOSITORY === repo && process.env.GITHUB_REF === 'refs/heads/main' &&
      process.env.GITHUB_ACTOR === 'KenLeeYa' && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch')) {
    throw new Error('Use the owner-dispatched workflow on main to publish.');
  }
  const items = JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8').replace(/^\uFEFF/, ''));
  for (const summary of processReport(items, mode, {readList:list, post:github, feedback:pullFeedback})) {
    console.log(JSON.stringify(summary));
  }
}

export function processReport(items, mode, {readList, post, feedback}) {
  if (!Array.isArray(items) || !items.length || items.length > 20) throw new Error('Expected 1 to 20 findings');
  const keys = new Set();
  for (const item of items) {
    reconcile(item, []);
    if (keys.has(item.key)) throw new Error('Duplicate key in report: ' + item.key);
    keys.add(item.key);
  }
  const tickets = readList('issues?state=all&sort=created&direction=asc');
  const summaries = [];
  for (const item of items) {
    let result = reconcile(item, tickets);
    if (result.action === 'update') result = reconcile(item, tickets, readList('issues/' + result.number + '/comments?direction=asc'));
    if (result.action === 'create') {
      if (mode === 'apply') {
        const ticket = post('issues', {title:item.title, body:result.body});
        tickets.push(ticket);
        result.number = ticket.number;
      } else {
        tickets.push({number:0, title:item.title, body:result.body, user:{login:bot}, state:'open'});
      }
    } else if (mode === 'apply' && result.action === 'update') {
      post('issues/' + result.number + '/comments', {body:result.body});
    }
    const summary = {...result, key:item.key, mode};
    if (result.kind === 'PR') summary.pr = feedback(result.number);
    delete summary.body;
    summaries.push(summary);
  }
  return summaries;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
