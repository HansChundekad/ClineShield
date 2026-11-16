import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate, pageCount } from '../src/utils/paginate.js';

test('first page starts at the first item', () => {
  assert.equal(paginate(['a', 'b', 'c'], 1, 2)[0], 'a');
});

test('page past the end is empty', () => {
  assert.deepEqual(paginate(['a', 'b'], 5, 2), []);
});

test('page count rounds up', () => {
  assert.equal(pageCount(5, 2), 3);
  assert.equal(pageCount(0, 2), 1);
});
