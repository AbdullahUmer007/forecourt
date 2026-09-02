import { describe, it, expect } from 'vitest';
import { catalogueSlug, namesMatch, uniqueByName, variantLabel } from './vehicle-catalogue.js';

describe('catalogueSlug', () => {
  it('turns a manufacturer name into a stable path segment', () => {
    expect(catalogueSlug('ALFA ROMEO')).toBe('alfa-romeo');
    expect(catalogueSlug('  Mercedes-Benz  ')).toBe('mercedes-benz');
  });
});

describe('variantLabel', () => {
  it('joins type, trim and power the way a dealer reads a card', () => {
    expect(variantLabel({
      typeName: 'A1 Sportback (GBA) 7.2018',
      name: '25 TFSI',
      hp: 95,
    })).toBe('A1 Sportback (GBA) 7.2018 · 25 TFSI · 95 HP');
  });

  it('omits a missing type or horsepower rather than inventing one', () => {
    expect(variantLabel({ name: '1.5 TSI' })).toBe('1.5 TSI');
  });
});

describe('uniqueByName', () => {
  const rows = [
    { name: 'AUDI', label: 'Audi' },
    { name: 'BMW' },
  ];

  it('matches case-insensitively', () => {
    const hit = uniqueByName(rows, 'audi');
    expect(hit.ok).toBe(true);
    if (hit.ok) expect(hit.row.name).toBe('AUDI');
  });

  it('refuses to guess when two rows share a name', () => {
    const clash = uniqueByName(
      [{ name: 'Golf' }, { name: 'Golf' }],
      'Golf',
    );
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.reason).toBe('ambiguous');
  });

  it('says missing rather than inventing a row', () => {
    const miss = uniqueByName(rows, 'Kia');
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.reason).toBe('missing');
  });
});

describe('namesMatch', () => {
  it('treats AUDI and audi as the same make', () => {
    expect(namesMatch('AUDI', ' audi ')).toBe(true);
    expect(namesMatch('AUDI', 'BMW')).toBe(false);
  });
});
