import { describe, it, expect } from 'vitest';
import { isHex64, normalizeHex, validate, type FieldErrors } from './validators';

describe('normalizeHex', () => {
  it('trims whitespace', () => {
    expect(normalizeHex(' abc123 ')).toBe('abc123');
  });

  it('strips 0x prefix', () => {
    expect(normalizeHex('0xABC123')).toBe('abc123');
  });

  it('lowercases hex characters', () => {
    expect(normalizeHex('ABCDEF0123456789')).toBe('abcdef0123456789');
  });

  it('strips whitespace and 0x prefix together', () => {
    expect(normalizeHex('  0xABC123  ')).toBe('abc123');
  });
});

describe('isHex64', () => {
  it('accepts a valid 64-character hex string', () => {
    expect(isHex64('c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c')).toBe(true);
  });

  it('accepts uppercase hex', () => {
    expect(isHex64('C476FC0553303EC4275BD4CB50AB7FA8182E343DBC4C721D7E2076FD77A5B56C')).toBe(true);
  });

  it('accepts 0x prefix', () => {
    expect(isHex64('0xc476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c')).toBe(
      true,
    );
  });

  it('accepts surrounding whitespace', () => {
    expect(isHex64('  c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c  ')).toBe(
      true,
    );
  });

  it('rejects strings that are too short', () => {
    expect(isHex64('abc123')).toBe(false);
  });

  it('rejects strings that are too long', () => {
    expect(isHex64('c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c00')).toBe(
      false,
    );
  });

  it('rejects non-hex characters', () => {
    expect(isHex64('g476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isHex64('')).toBe(false);
  });
});

describe('validate', () => {
  it('returns no errors for valid input', () => {
    const errors = validate(
      '1',
      'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
      '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1\n1733fad16ada0c23d8cdaff52bea66bea308dddddcb79348842acef0065c9615',
    );
    expect(errors).toEqual({});
  });

  describe('batchId validation', () => {
    it('rejects empty batch ID', () => {
      const errors = validate(
        '',
        'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
        '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
      );
      expect(errors.batchId).toBe('Batch ID is required.');
    });

    it('rejects non-numeric batch ID', () => {
      const errors = validate(
        'abc',
        'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
        '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
      );
      expect(errors.batchId).toBe('Batch ID must be a whole number.');
    });

    it('rejects batch ID with decimals', () => {
      const errors = validate(
        '1.5',
        'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
        '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
      );
      expect(errors.batchId).toBe('Batch ID must be a whole number.');
    });

    it('rejects batch ID with spaces', () => {
      const errors = validate(
        ' 1 ',
        'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
        '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
      );
      expect(errors.batchId).toBeUndefined();
    });

    it('accepts numeric batch ID', () => {
      const errors = validate(
        '42',
        'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
        '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
      );
      expect(errors.batchId).toBeUndefined();
    });
  });

  describe('leaf validation', () => {
    it('rejects empty leaf', () => {
      const errors = validate(
        '1',
        '',
        '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
      );
      expect(errors.leaf).toBe('Receipt hash is required.');
    });

    it('rejects leaf that is too short', () => {
      const errors = validate(
        '1',
        'abc123',
        '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
      );
      expect(errors.leaf).toBe('Must be exactly 64 hex characters (a 32-byte hash).');
    });

    it('rejects leaf with non-hex characters', () => {
      const errors = validate(
        '1',
        'g476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
        '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
      );
      expect(errors.leaf).toBe('Must be exactly 64 hex characters (a 32-byte hash).');
    });

    it('accepts leaf with 0x prefix', () => {
      const errors = validate(
        '1',
        '0xc476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
        '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
      );
      expect(errors.leaf).toBeUndefined();
    });

    it('accepts leaf with surrounding whitespace', () => {
      const errors = validate(
        '1',
        '  c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c  ',
        '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
      );
      expect(errors.leaf).toBeUndefined();
    });
  });

  describe('proof validation', () => {
    it('rejects empty proof', () => {
      const errors = validate(
        '1',
        'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
        '',
      );
      expect(errors.proof).toBe('At least one sibling hash is required.');
    });

    it('rejects proof with whitespace only', () => {
      const errors = validate(
        '1',
        'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
        '   ',
      );
      expect(errors.proof).toBe('At least one sibling hash is required.');
    });

    it('rejects first invalid proof element', () => {
      const errors = validate(
        '1',
        'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
        'invalid\n7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
      );
      expect(errors.proof).toBe('Sibling #1 is not a valid 64-character hex hash.');
    });

    it('rejects second invalid proof element', () => {
      const errors = validate(
        '1',
        'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
        '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1\ninvalid',
      );
      expect(errors.proof).toBe('Sibling #2 is not a valid 64-character hex hash.');
    });

    it('accepts proof with comma separators', () => {
      const errors = validate(
        '1',
        'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
        '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1,1733fad16ada0c23d8cdaff52bea66bea308dddddcb79348842acef0065c9615',
      );
      expect(errors.proof).toBeUndefined();
    });

    it('accepts proof with mixed whitespace separators', () => {
      const errors = validate(
        '1',
        'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
        '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1 \t 1733fad16ada0c23d8cdaff52bea66bea308dddddcb79348842acef0065c9615',
      );
      expect(errors.proof).toBeUndefined();
    });

    it('accepts proof elements with 0x prefix', () => {
      const errors = validate(
        '1',
        'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
        '0x7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
      );
      expect(errors.proof).toBeUndefined();
    });
  });

  describe('multiple errors', () => {
    it('reports errors for multiple fields simultaneously', () => {
      const errors = validate('abc', 'short', '');
      expect(errors.batchId).toBe('Batch ID must be a whole number.');
      expect(errors.leaf).toBe('Must be exactly 64 hex characters (a 32-byte hash).');
      expect(errors.proof).toBe('At least one sibling hash is required.');
    });
  });
});
