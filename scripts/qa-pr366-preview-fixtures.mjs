import { assertTarget } from './qa-pr366-preview-ui.mjs';

const organizationId = '11111111-1111-4111-8111-111111111111';
const stallId = '22222222-2222-4222-8222-222222222222';

// request must be the authenticated Playwright APIRequestContext from the bound browser.
// This module has no CLI, database connection, login, or automatic remote execution.
export function createFixtureClient({ receipt, binding, request, csrfToken, save, now = Date.now }) {
  const origin = assertTarget(receipt, binding, now());
  if (!csrfToken || typeof save !== 'function' || !request?.fetch) throw Error('FIXTURE_SESSION_REQUIRED');
  const endpoint = `/api/merchant/organizations/${organizationId}/operating-profit`;
  async function call(method, data, date) {
    assertTarget(receipt, binding, now());
    const url = `${origin}${endpoint}?dateFrom=${date}&dateTo=${date}`;
    const response = await request.fetch(url, { method, maxRedirects: 0,
      headers: { 'Content-Type': 'application/json', Origin: origin, 'x-csrf-token': csrfToken },
      ...(data ? { data } : {}) });
    if (response.status() !== (method === 'POST' ? 201 : 200)) throw Error('FIXTURE_API_REJECTED');
    const body = await response.json();
    if (!Array.isArray(body.expenses)) throw Error('FIXTURE_API_SHAPE_CHANGED');
    return body;
  }
  return {
    async prepareExpenses(count = 13) {
      if (!Number.isInteger(count) || count < 1 || count > 13) throw Error('FIXTURE_BOUND_EXCEEDED');
      assertTarget(receipt, binding, now());
      const identity = await request.fetch(`${origin}/api/auth/me`, { method: 'GET', maxRedirects: 0 });
      if (identity.status() !== 200 || (await identity.json()).user?.email !== 'owner@stallorder.test') throw Error('FIXTURE_ACTOR_DENIED');
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now()));
      const marker = `PR366 ${receipt.resourceKey} expense`;
      const before = await call('GET', undefined, date);
      if (before.expenses.some(row => row.description?.startsWith(marker))) throw Error('FIXTURE_ALREADY_PRESENT');
      const evidence = { resourceKey: receipt.resourceKey, childRef: binding.childRef,
        deploymentId: binding.deploymentId, sha: binding.sha, tree: binding.tree,
        kind: 'DENSE_EXPENSES', date, marker, createdIds: [], amountEach: 100,
        cleanup: 'RETAIN_AUDITED_ROWS_UNTIL_EXACT_CHILD_TEARDOWN', status: 'PREPARING',
        pending: ['PUBLIC_HOURS_NO_AUTHENTICATED_GET_SNAPSHOT_API', 'STAFF_POS_ORDER_ACTIONS', 'DENSE_SUPPLY_SCHEDULE_INVOICE'] };
      await save(evidence);
      for (let index = 0; index < count; index++) {
        const description = `${marker} ${index + 1}`;
        const dashboard = await call('POST', { operation: 'CREATE_EXPENSE', stallId,
          expenseDate: date, category: 'OTHER', customCategoryName: '隔離介面測試',
          amount: 100, description, isRecurring: false }, date);
        const matches = dashboard.expenses.filter(row => row.description === description);
        if (matches.length !== 1 || typeof matches[0].id !== 'string') throw Error('FIXTURE_CREATED_ID_UNVERIFIED');
        evidence.createdIds.push(matches[0].id);
        await save(evidence);
      }
      const after = await call('GET', undefined, date);
      if (evidence.createdIds.some(id => !after.expenses.some(row => row.id === id && row.amount === 100))) throw Error('FIXTURE_READBACK_FAILED');
      evidence.status = 'READBACK_VERIFIED';
      evidence.expectedFixtureTotal = count * 100;
      evidence.beforeTotalRows = before.expenses.length;
      evidence.totalRows = after.expenses.length;
      evidence.expectedVisibleIds = after.expenses.map(row => row.id);
      evidence.expectedVisibleDescriptions = after.expenses.map(row => row.description);
      evidence.summary = after.summary;
      evidence.ui = { url: `${origin}/merchant/operating-profit?organizationId=${organizationId}&dateFrom=${date}&dateTo=${date}`,
        listLabel: '已入帳支出', mobileInitial: Math.min(count, 6), mobileMore: Math.min(count, 12),
        desktopRows: count, aggregateDelta: count * 100 };
      await save(evidence);
      return evidence;
    },
  };
}
