import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpenClawSessionKey,
  getDefaultOpenClawSessionId,
  getDefaultSessionKeyPrefix,
  getTaskOpenClawSessionId,
  normalizeOpenClawSessionId,
} from './session-routing';

test('gateway agents default to agent-specific routing prefixes', () => {
  assert.equal(
    getDefaultSessionKeyPrefix({ gateway_agent_id: 'researcher' }),
    'agent:researcher:'
  );
});

test('gateway agents default to the main session id', () => {
  assert.equal(
    getDefaultOpenClawSessionId({ name: 'researcher', gateway_agent_id: 'researcher' }),
    'main'
  );
});

test('legacy mission-control session ids are normalized for gateway agents', () => {
  assert.equal(
    normalizeOpenClawSessionId(
      { gateway_agent_id: 'researcher' },
      'mission-control-researcher'
    ),
    'main'
  );
});

test('buildOpenClawSessionKey composes the current gateway main session key', () => {
  assert.equal(
    buildOpenClawSessionKey(
      { gateway_agent_id: 'researcher' },
      'mission-control-researcher'
    ),
    'agent:researcher:main'
  );
});

test('explicit session prefixes are preserved and normalized', () => {
  assert.equal(
    buildOpenClawSessionKey(
      { session_key_prefix: 'agent:teleclaw', gateway_agent_id: 'teleclaw' },
      'main'
    ),
    'agent:teleclaw:main'
  );
});

test('session routing falls back to task- and name-based ids when no gateway agent id exists', () => {
  assert.equal(
    getDefaultOpenClawSessionId({ name: 'Research Builder' }),
    'mission-control-research-builder'
  );

  assert.equal(
    getTaskOpenClawSessionId({ name: 'Research Builder' }, 'Task 42'),
    'mission-control-research-builder-task-42'
  );

  assert.equal(
    normalizeOpenClawSessionId({ name: 'Research Builder' }, 'custom-session'),
    'custom-session'
  );

  assert.equal(
    buildOpenClawSessionKey({ name: 'Research Builder' }, 'custom-session'),
    'agent:main:custom-session'
  );
});

test('explicit session key prefixes gain a trailing colon', () => {
  assert.equal(
    getDefaultSessionKeyPrefix({ session_key_prefix: 'agent:teleclaw' }),
    'agent:teleclaw:'
  );
});
