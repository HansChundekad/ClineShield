// Formatting helpers from the v0 API. Nothing imports this since the v1 routes landed.
export function formatNoteV0(note) {
  return { note_id: note.id, note_title: note.title, created: note.createdAt };
}
