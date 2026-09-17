export type ThreadSystem = 'metric' | 'unc' | 'unf';

export interface ThreadStandard {
  id: string;
  /** Standard designation, e.g. "M6 × 1.0" or "1/4-20 UNC". */
  label: string;
  system: ThreadSystem;
  majorDiameterMM: number;
  pitchMM: number;
  /** Threads per inch, shown for imperial sizes instead of a pitch in mm. */
  tpi?: number;
}

const IN_TO_MM = 25.4;

function metricSize(diameterMM: number, pitchMM: number): ThreadStandard {
  return {
    id: `metric-${diameterMM}x${pitchMM}`,
    label: `M${diameterMM} × ${pitchMM}`,
    system: 'metric',
    majorDiameterMM: diameterMM,
    pitchMM,
  };
}

function unifiedSize(designation: string, majorDiameterIn: number, tpi: number, system: 'unc' | 'unf'): ThreadStandard {
  return {
    id: `${system}-${designation}`,
    label: `${designation} ${system.toUpperCase()}`,
    system,
    majorDiameterMM: majorDiameterIn * IN_TO_MM,
    pitchMM: IN_TO_MM / tpi,
    tpi,
  };
}

/**
 * Common hardware thread sizes. Both families share the same 60° V
 * fundamental profile (ISO 68-1 for metric, ASME B1.1 for Unified inch
 * threads) — only the nominal diameter/pitch values differ. See
 * threadGeometry.ts for the shared profile math.
 */
export const THREAD_STANDARDS: ThreadStandard[] = [
  // ISO metric, coarse pitch
  metricSize(2, 0.4),
  metricSize(2.5, 0.45),
  metricSize(3, 0.5),
  metricSize(4, 0.7),
  metricSize(5, 0.8),
  metricSize(6, 1.0),
  metricSize(8, 1.25),
  metricSize(10, 1.5),
  metricSize(12, 1.75),
  metricSize(14, 2.0),
  metricSize(16, 2.0),
  metricSize(18, 2.5),
  metricSize(20, 2.5),

  // Unified National Coarse (UNC)
  unifiedSize('#4-40', 0.112, 40, 'unc'),
  unifiedSize('#6-32', 0.138, 32, 'unc'),
  unifiedSize('#8-32', 0.164, 32, 'unc'),
  unifiedSize('#10-24', 0.19, 24, 'unc'),
  unifiedSize('1/4-20', 0.25, 20, 'unc'),
  unifiedSize('5/16-18', 0.3125, 18, 'unc'),
  unifiedSize('3/8-16', 0.375, 16, 'unc'),
  unifiedSize('7/16-14', 0.4375, 14, 'unc'),
  unifiedSize('1/2-13', 0.5, 13, 'unc'),
  unifiedSize('5/8-11', 0.625, 11, 'unc'),
  unifiedSize('3/4-10', 0.75, 10, 'unc'),

  // Unified National Fine (UNF)
  unifiedSize('#4-48', 0.112, 48, 'unf'),
  unifiedSize('#6-40', 0.138, 40, 'unf'),
  unifiedSize('#8-36', 0.164, 36, 'unf'),
  unifiedSize('#10-32', 0.19, 32, 'unf'),
  unifiedSize('1/4-28', 0.25, 28, 'unf'),
  unifiedSize('5/16-24', 0.3125, 24, 'unf'),
  unifiedSize('3/8-24', 0.375, 24, 'unf'),
  unifiedSize('7/16-20', 0.4375, 20, 'unf'),
  unifiedSize('1/2-20', 0.5, 20, 'unf'),
  unifiedSize('5/8-18', 0.625, 18, 'unf'),
  unifiedSize('3/4-16', 0.75, 16, 'unf'),
];

export function findThreadStandard(id: string | null | undefined): ThreadStandard | null {
  if (!id) return null;
  return THREAD_STANDARDS.find((t) => t.id === id) ?? null;
}

export const THREAD_SYSTEM_LABELS: Record<ThreadSystem, string> = {
  metric: 'Metric (ISO)',
  unc: 'Unified Coarse (UNC)',
  unf: 'Unified Fine (UNF)',
};
