/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { cardLikeLines, luhn } from './check-private';

// test numbers are built at run time so this file holds none of them
const visa = ['4111', '1111', '1111', '1111'];
const amex = ['3782', '822463', '10005'];

describe('card-number-like values', () => {
  test('Luhn', () => {
    expect(luhn(visa.join(''))).toBe(true);
    expect(luhn(amex.join(''))).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
  });

  test('grouped, plain and Amex-grouped numbers are found by line', () => {
    expect(cardLikeLines(`ok\nAccount# ${visa.join(' ')}\n${visa.join('')}\n${amex.join(' ')}\n${visa.join('-')}`)).toEqual([2, 3, 4, 5]);
  });

  test('masked numbers, failing checksums, decimals and longer digit runs are not', () => {
    expect(cardLikeLines(`Account Number: XXXX XXXX XXXX 1234\n4111 1111 1111 1112\n0.${visa.join('')}\n${visa.join('')}99999`)).toEqual([]);
  });
});
