export type Units = 'mm' | 'in';

const MM_PER_INCH = 25.4;

/** Converts an internal mm value to the user's chosen display unit. */
export function mmToDisplay(mm: number, units: Units): number {
  return units === 'in' ? mm / MM_PER_INCH : mm;
}

/** Converts a value typed in the user's chosen display unit back to internal mm. */
export function displayToMM(value: number, units: Units): number {
  return units === 'in' ? value * MM_PER_INCH : value;
}

export function unitSuffix(units: Units): string {
  return units === 'in' ? 'in' : 'mm';
}

/** Formats a number for display in a text input — trims float noise without forcing a fixed decimal count while typing. */
export function formatNumber(value: number, precision = 4): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number(value.toFixed(precision));
  return String(rounded);
}
