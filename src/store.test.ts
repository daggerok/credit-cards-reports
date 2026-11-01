/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { fromSaved, toSaved } from './store';

describe('files kept over a reload', () => {
  test('toSaved keeps the files that were read, drops the ones still parsing or without text', () => {
    expect(toSaved([
      { name: 'a.pdf', status: 'done', text: 'Chase\nNew Balance $1.00' },
      { name: 'b.pdf', status: 'parsing', text: '' },
      { name: 'c.pdf', status: 'error', text: '' },
      { name: 'd.pdf', status: 'error', text: 'Some other bank' },
    ])).toEqual([{ name: 'a.pdf', text: 'Chase\nNew Balance $1.00' }, { name: 'd.pdf', text: 'Some other bank' }]);
  });

  test('fromSaved takes only well-formed entries, once per name', () => {
    expect(fromSaved(null)).toEqual([]);
    expect(fromSaved({ name: 'a.pdf', text: 'x' })).toEqual([]);
    expect(fromSaved([
      { name: 'a.pdf', text: 'x' },
      { name: 'a.pdf', text: 'y' },
      { name: '', text: 'x' },
      { name: 'b.pdf', text: '' },
      { name: 'c.pdf' },
      'junk',
      null,
      { name: 'd.pdf', text: 'z', extra: 1 },
    ])).toEqual([{ name: 'a.pdf', text: 'x' }, { name: 'd.pdf', text: 'z' }]);
  });

  test('round trip through JSON', () => {
    const saved = toSaved([{ name: 'a.pdf', status: 'done', text: 'line 1\nline 2' }]);
    expect(fromSaved(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });
});
