import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TodoList } from '../src/todo.js';

test('adds items and counts remaining', () => {
  const list = new TodoList();
  list.add('write the quickstart');
  list.add('attach loopdog');
  assert.equal(list.remaining(), 2);
});

test('completing an item drops it from remaining and sorts it last', () => {
  const list = new TodoList();
  const a = list.add('a');
  list.add('b');
  list.complete(a.id);
  assert.equal(list.remaining(), 1);
  assert.deepEqual(
    list.list().map((i) => i.title),
    ['b', 'a'],
  );
});

test('rejects an empty title and an unknown id', () => {
  const list = new TodoList();
  assert.throws(() => list.add(''), /title is required/);
  assert.throws(() => list.complete(999), /no todo #999/);
});
