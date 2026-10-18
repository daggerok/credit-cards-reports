/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { itemsToLines } from './pdf-text';

const item = (str: string, x: number, y: number, w = str.length * 5, h = 10) => ({ str, x, y, w, h });

describe('itemsToLines', () => {
  test('items on one baseline join left to right, top line first', () => {
    expect(itemsToLines([item('$224.57', 300, 700), item('New Balance', 50, 700), item('Previous Balance', 50, 720)])).toEqual(['Previous Balance', 'New Balance  $224.57']);
  });

  test('a small gap is one space, touching items join, a wide gap is two spaces', () => {
    expect(itemsToLines([item('Payment', 0, 10, 35), item('Due', 37, 10, 15), item('Date', 54, 10, 20), item('11/01/26', 120, 10, 40)])).toEqual(['Payment Due Date  11/01/26']);
    expect(itemsToLines([item('Ac', 0, 10, 10), item('count', 10, 10, 25)])).toEqual(['Account']);
  });

  test('a baseline off by less than half a glyph stays on the line; blank items are dropped', () => {
    expect(itemsToLines([item('Fees', 0, 100), item('$0.00', 100, 98), item('  ', 50, 50)])).toEqual(['Fees  $0.00']);
  });
});
