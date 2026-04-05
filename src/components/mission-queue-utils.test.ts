import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getDispatchFailureMessage } from './mission-queue-utils';

test('getDispatchFailureMessage returns the backend conflict message', () => {
  const body = JSON.stringify({
    warning: 'Other orchestrators available',
    message: 'There are 3 other orchestrators available in this workspace: clawson, researcher, teleclaw. Consider assigning this task to them instead.',
    otherOrchestrators: [
      { name: 'clawson' },
      { name: 'researcher' },
      { name: 'teleclaw' },
    ],
  });

  const result = getDispatchFailureMessage(409, body);

  assert.equal(
    result,
    'There are 3 other orchestrators available in this workspace: clawson, researcher, teleclaw. Consider assigning this task to them instead.'
  );
});