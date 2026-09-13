/** Convert an unambiguous UK wall-clock minute to UTC. Reject DST gaps and repeated hours. */
export function ukAppointmentTime(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const naive = Date.parse(local + ':00Z');
  if (!Number.isFinite(naive)) return null;
  const format = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const matches = [naive, naive - 3600000].filter(
    (t) => format.format(new Date(t)).replace(' ', 'T') === local,
  );
  return matches.length === 1 ? new Date(matches[0]!).toISOString() : null;
}
