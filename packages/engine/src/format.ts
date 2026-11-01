// One human-readable formatter for fact values, shared by every renderer. Display only: the engine
// compares and stores the exact values, never these strings.

const groupInteger = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return 'unknown';
  if (typeof v === 'string') return v;
  const o = v as Record<string, unknown>;
  if ('amount' in o) {
    const [int = '', dec] = String(o.amount).split('.');
    return `${o.currency ?? '?'} ${groupInteger(int)}${dec !== undefined ? `.${dec}` : ''}`;
  }
  if ('value' in o) return `${o.value}${o.unit ? ` ${o.unit}` : ''}`;
  return JSON.stringify(v);
}
