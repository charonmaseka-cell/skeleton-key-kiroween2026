import { describe, expect, it } from 'vitest';
import { decide, saveNote, type Finding } from '../src';

// D1 (beta sweep): a note saved on its own is kept in the current decision and in its history.
const finding = { id: 'f1', fingerprint: 'fp' } as unknown as Finding;

describe('saveNote', () => {
  it('after a decision: keeps the status, sets the note, records a "noted" history entry', () => {
    const s0 = decide({}, finding, 'accepted', undefined, 1);
    const s1 = saveNote(s0, finding, 'called them', 2);
    expect(s1.f1).toMatchObject({ status: 'accepted', note: 'called them' });
    expect(s1.f1!.history.map((h) => `${h.event}:${h.status}`)).toEqual(['decided:accepted', 'noted:accepted']);
  });
  it('an unchanged note adds nothing; clearing a note is recorded; a note on an undecided item is kept as open', () => {
    const s1 = saveNote({}, finding, 'first', 1);
    expect(s1.f1).toMatchObject({ status: 'open', note: 'first' });
    expect(saveNote(s1, finding, 'first', 2)).toBe(s1);
    const s2 = saveNote(s1, finding, '  ', 3);
    expect(s2.f1!.note).toBeUndefined();
    expect(s2.f1!.history).toHaveLength(2);
  });
});
