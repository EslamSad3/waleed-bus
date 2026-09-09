/**
 * Egyptian mobile canonical form: `01XXXXXXXXX` (11 digits).
 * Accepted inputs: `01…`, `+201…`, `00201…` (whitespace/dashes ignored).
 * Throws a plain Error on invalid input — callers map it to 422.
 */
export function normalizePhone(input: string): string {
  const compact = input.trim().replace(/[\s-]+/g, '');
  let canonical = compact;
  if (compact.startsWith('+20')) canonical = `0${compact.slice(3)}`;
  else if (compact.startsWith('0020')) canonical = `0${compact.slice(4)}`;
  if (!/^01\d{9}$/.test(canonical)) throw new Error('Invalid phone number');
  return canonical;
}

export function isPhoneLike(input: string): boolean {
  try {
    normalizePhone(input);
    return true;
  } catch {
    return false;
  }
}
