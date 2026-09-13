import { describe, expect, it } from 'vitest';
import { ukAppointmentTime } from './appointment-time';
describe('UK appointment times', () => {
  it('converts winter and summer without depending on the computer timezone', () => {
    expect(ukAppointmentTime('2030-01-10T10:30')).toBe(
      '2030-01-10T10:30:00.000Z',
    );
    expect(ukAppointmentTime('2030-07-10T10:30')).toBe(
      '2030-07-10T09:30:00.000Z',
    );
  });
  it('rejects missing and repeated clock-change times', () => {
    expect(ukAppointmentTime('2026-03-29T01:30')).toBeNull();
    expect(ukAppointmentTime('2026-10-25T01:30')).toBeNull();
    expect(ukAppointmentTime('2026-10-25T02:30')).toBe(
      '2026-10-25T02:30:00.000Z',
    );
  });
  it('rejects invalid and normalized dates', () => {
    for (const s of [
      '',
      'bad',
      '2030-02-30T12:00',
      '2030-01-01T24:00',
      '2030-01-01T12:00Z',
    ])
      expect(ukAppointmentTime(s)).toBeNull();
  });
});
