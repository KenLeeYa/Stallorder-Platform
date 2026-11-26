import { describe, it, expect } from 'vitest';
import { reconcile, nextTicket, processReport } from './weekly-report.mjs';

const finding = {
  key: 'line.liff-sdk', title: 'Update LIFF SDK', evidence: ['https://developers.line.biz/en/docs/liff/release-notes/'],
  revision: 'a'.repeat(40), acceptance: 'Verify the LIFF login callback.', risk: 'standard',
};
const ticket = {number: 20, title: finding.title, state: 'open', user: {login: 'github-actions[bot]'}, body: ''};

describe('weekly report intake', () => {
  it('creates once and leaves an identical report unchanged', () => {
    const first = reconcile(finding, []);
    expect(first.action).toBe('create');
    expect(reconcile(finding, [{...ticket, body: first.body}]).action).toBe('unchanged');
  });
  it('keeps human notes while appending new evidence', () => {
    const original = reconcile(finding, []).body + '\nHuman notes';
    const next = {...finding, revision: 'b'.repeat(40)};
    const update = reconcile(next, [{...ticket, body: original}]);
    expect(update.action).toBe('update');
    expect(update.body).not.toContain('Human notes');
    expect(reconcile(next, [{...ticket, body: original}], [{body: update.body, user: ticket.user}]).action).toBe('unchanged');
  });
  it('uses an existing PR and requires review for ambiguous or closed tickets', () => {
    expect(reconcile({...finding, tracking: 20}, [{...ticket, pull_request: {}}]).action).toBe('tracked');
    expect(reconcile(finding, [ticket]).action).toBe('review');
    expect(reconcile({...finding, tracking: 21}, [ticket]).action).toBe('review');
    const {body} = reconcile(finding, []);
    expect(reconcile(finding, [{...ticket, body, state:'closed'}]).action).toBe('review');
    expect(reconcile(finding, [{...ticket, body}, {...ticket, number:21, body}]).action).toBe('review');
  });
  it('rejects incomplete evidence or a malformed key before producing a write', () => {
    for (const change of [{key:'../x'}, {evidence:[]}, {revision:'main'}, {risk:'auto-deploy'}, {acceptance:' '}, {tracking:-1}]) {
      expect(() => reconcile({...finding,...change}, [])).toThrow();
    }
  });
});

it('returns one low-risk ticket and respects later risk escalation and an active claim', () => {
  const eligible = {...ticket, labels: [], body: reconcile(finding, []).body};
  const sensitive = {...eligible, number: 22, comments: 1};
  const claimed = {...eligible, number: 21, labels: [{name:'codex-in-progress'}]};
  const note = reconcile({...finding, risk:'sensitive'}, [eligible]).body;
  expect(nextTicket([sensitive, claimed, eligible], () => [{user:ticket.user, body:note}])).toEqual(eligible);
  expect(nextTicket([sensitive, claimed], () => [{user:ticket.user, body:note}])).toBeNull();
});

it('plans, publishes, replays and updates a report without duplicating an Issue or evidence', () => {
  const issues = [], comments = [];
  const api = {
    readList: path => path.startsWith('issues?') ? [...issues] : [...comments],
    post: (path, payload) => {
      const row = {...payload, state:'open', user:ticket.user, number:1};
      if (path === 'issues') issues.push(row);
      else if (path === 'issues/1/comments') comments.push(row);
      else throw Error('Unexpected write: ' + path);
      return row;
    },
  };
  const run = (mode, item) => processReport([item], mode, api)[0].action;
  expect(run('plan', finding)).toBe('create');
  expect(issues).toHaveLength(0);
  expect(run('apply', finding)).toBe('create');
  expect(run('apply', finding)).toBe('unchanged');
  const revised = {...finding, acceptance:'Verify store switching too.'};
  expect(run('apply', revised)).toBe('update');
  expect(run('apply', revised)).toBe('unchanged');
  expect(issues).toHaveLength(1);
  expect(comments).toHaveLength(1);
});
