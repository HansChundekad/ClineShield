import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('adds and gets a note', () => {
  const store = createStore();
  const note = store.add({ title: 'groceries', body: 'milk' });
  assert.equal(store.get(note.id).title, 'groceries');
});

test('removes a note', () => {
  const store = createStore();
  const note = store.add({ title: 'temp' });
  assert.equal(store.remove(note.id), true);
  assert.equal(store.get(note.id), null);
  assert.equal(store.remove(note.id), false);
});

test('counts notes', () => {
  const store = createStore();
  store.add({ title: 'a' });
  store.add({ title: 'b' });
  assert.equal(store.count(), 2);
});
