// In-memory note store. Swapped for SQLite in production (see DATABASE_URL).
export function createStore() {
  const notes = [];
  let nextId = 1;
  return {
    add({ title, body = '', tags = [] }) {
      const note = { id: nextId++, title, body, tags, createdAt: new Date().toISOString() };
      notes.push(note);
      return note;
    },
    get(id) {
      return notes.find(n => n.id === id) ?? null;
    },
    remove(id) {
      const i = notes.findIndex(n => n.id === id);
      if (i === -1) return false;
      notes.splice(i, 1);
      return true;
    },
    list() {
      return [...notes];
    },
    count() {
      return notes.length;
    },
  };
}
