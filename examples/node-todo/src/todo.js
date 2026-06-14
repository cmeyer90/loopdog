// A tiny in-memory todo list — the "real app" Loopdog is attached to in this
// example. Deliberately small: the point is the *attachment*, not the app.

export class TodoList {
  #items = [];
  #nextId = 1;

  add(title) {
    if (!title || typeof title !== 'string') throw new Error('title is required');
    const item = { id: this.#nextId++, title, done: false };
    this.#items.push(item);
    return item;
  }

  complete(id) {
    const item = this.#items.find((i) => i.id === id);
    if (!item) throw new Error(`no todo #${id}`);
    item.done = true;
    return item;
  }

  /** Open items first, then completed — both in insertion order. */
  list() {
    return [...this.#items].sort((a, b) => Number(a.done) - Number(b.done));
  }

  remaining() {
    return this.#items.filter((i) => !i.done).length;
  }
}
