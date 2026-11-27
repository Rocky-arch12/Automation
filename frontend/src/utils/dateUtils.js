export function parseUtcDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  let s = String(ts).trim();
  // Normalize SQLite "YYYY-MM-DD HH:MM:SS" or ISO strings lacking timezone offset as UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    s = s.replace(' ', 'T') + 'Z';
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
    s = s + 'Z';
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatLocalTime(ts, withSeconds = true) {
  const d = parseUtcDate(ts);
  if (!d) return '';
  const opts = withSeconds
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' };
  return d.toLocaleTimeString([], opts);
}
