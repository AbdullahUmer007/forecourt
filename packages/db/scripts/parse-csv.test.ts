import { describe, it, expect } from 'vitest';
import { parseCsv } from './parse-csv.mjs';

describe('parseCsv', () => {
  it('keeps a comma that lives inside quotes', () => {
    const rows = parseCsv(
      'id,name\n22,"1.6 i.e. 16V T.S. (930.B2B, 930.B2C)"\n',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['name']).toBe('1.6 i.e. 16V T.S. (930.B2B, 930.B2C)');
  });

  it('reads the vehicles.csv header the seed script depends on', () => {
    const rows = parseCsv(
      'id,manufacturer,model,type,external_id,name,kw,hp,power,slug,source_url\n'
      + '1,AUDI,A1,A1 Sportback (GBA) 7.2018,135143,25 TFSI,70,95,70 KW / 95 HP,audi-a1,https://example.com\n',
    );
    expect(rows[0]).toMatchObject({
      manufacturer: 'AUDI',
      model: 'A1',
      name: '25 TFSI',
      hp: '95',
    });
  });
});
