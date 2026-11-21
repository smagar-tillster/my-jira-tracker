// Which sprint ticket statuses count as ready on To Release Today (same buckets as the Tasks list).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReadyTicket } from '../lib/delivery.mjs';

const t = (status, statusCategory = 'In Progress') => ({ status, statusCategory });

test('Ready for QA and In QA count as ready, as does anything Jira calls Done', () => {
  assert.equal(isReadyTicket(t('Ready for QA')), true);
  assert.equal(isReadyTicket(t('In QA')), true);
  assert.equal(isReadyTicket(t('Passed QA', 'Done')), true);
});

test('work that is not at QA yet, or came back from it, is not ready', () => {
  for (const s of ['To Do', 'In Development', 'Code Review', 'Returned by QA', 'Blocked', 'Waiting for Client']) assert.equal(isReadyTicket(t(s)), false, s);
});
