import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNextTaskId,
  parseBacklogMarkdown,
  parseHistoryMarkdown,
  serializeBacklogMarkdown,
  serializeHistoryMarkdown
} from '../../tools/backlog_markdown.mjs';

test('backlog markdown round-trips multiline description, options, and resolution', () => {
  const tasks = [
    {
      id: 'TASK-001',
      description: 'First paragraph.\n\nSecond paragraph.',
      options: [
        'Option one line 1.\nOption one line 2.',
        'Option two.\n\nSecond paragraph.'
      ],
      resolution: 'Resolved.\n\nWith more detail.'
    }
  ];

  const markdown = serializeBacklogMarkdown(tasks);
  const parsed = parseBacklogMarkdown(markdown);

  assert.deepEqual(parsed, tasks);
});

test('history markdown round-trips task records', () => {
  const tasks = [
    {
      id: 'TASK-004',
      description: 'Finished task.',
      options: [],
      resolution: 'Implemented and verified.'
    }
  ];

  const markdown = serializeHistoryMarkdown(tasks);
  const parsed = parseHistoryMarkdown(markdown);

  assert.deepEqual(parsed, tasks);
});

test('createNextTaskId increments from persisted task ids', () => {
  const next = createNextTaskId([
    { id: 'TASK-001' },
    { id: 'TASK-009' },
    { id: 'TASK-010' }
  ]);

  assert.equal(next, 'TASK-011');
});
