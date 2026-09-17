export type PrinterClass = 'fdm' | 'resin';

export interface PrinterProfile {
  id: string;
  name: string;
  manufacturer: string;
  class: PrinterClass;
  buildVolumeMM: { x: number; y: number; z: number };
  /** Nozzle diameter for FDM, or effective XY pixel/laser spot size for resin. */
  nozzleDiameterMM: number;
  layerHeightRangeMM: [number, number];
  /** Diametral clearance added to internal (tapped) threads so a print accepts a real bolt. */
  internalThreadClearanceMM: number;
}

/**
 * Common desktop 3D printers, with the specs that actually matter for
 * thread printability: nozzle/spot size (bounds how fine a crest/root the
 * machine can resolve) and layer height (bounds how smoothly it can
 * approximate the helical profile vertically). Figures are each machine's
 * published/typical stock configuration, not every optional nozzle size.
 */
/** Default/fallback profile id — used whenever nothing more specific has been picked. */
export const GENERIC_PRINTER_ID = 'generic-fdm-0.4';

export const PRINTER_PROFILES: PrinterProfile[] = [
  {
    id: GENERIC_PRINTER_ID,
    name: 'Generic FDM (0.4mm nozzle)',
    manufacturer: 'Generic',
    class: 'fdm',
    buildVolumeMM: { x: 220, y: 220, z: 250 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.12, 0.28],
    internalThreadClearanceMM: 0.3,
  },
  {
    id: 'bambulab-x1c',
    name: 'Bambu Lab X1 Carbon',
    manufacturer: 'Bambu Lab',
    class: 'fdm',
    buildVolumeMM: { x: 256, y: 256, z: 256 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.08, 0.28],
    internalThreadClearanceMM: 0.25,
  },
  {
    id: 'bambulab-p1s',
    name: 'Bambu Lab P1S',
    manufacturer: 'Bambu Lab',
    class: 'fdm',
    buildVolumeMM: { x: 256, y: 256, z: 256 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.08, 0.28],
    internalThreadClearanceMM: 0.25,
  },
  {
    id: 'prusa-mk4',
    name: 'Prusa MK4',
    manufacturer: 'Prusa Research',
    class: 'fdm',
    buildVolumeMM: { x: 250, y: 210, z: 220 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.05, 0.3],
    internalThreadClearanceMM: 0.25,
  },
  {
    id: 'creality-ender3-v2',
    name: 'Creality Ender 3 V2',
    manufacturer: 'Creality',
    class: 'fdm',
    buildVolumeMM: { x: 220, y: 220, z: 250 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.1, 0.3],
    internalThreadClearanceMM: 0.35,
  },
  {
    id: 'creality-k1c',
    name: 'Creality K1C',
    manufacturer: 'Creality',
    class: 'fdm',
    buildVolumeMM: { x: 220, y: 220, z: 250 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.1, 0.3],
    internalThreadClearanceMM: 0.3,
  },
  {
    id: 'voron-2.4-350',
    name: 'Voron 2.4 (350mm)',
    manufacturer: 'Voron Design',
    class: 'fdm',
    buildVolumeMM: { x: 350, y: 350, z: 350 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.05, 0.3],
    internalThreadClearanceMM: 0.25,
  },
  {
    id: 'ultimaker-s5',
    name: 'Ultimaker S5',
    manufacturer: 'Ultimaker',
    class: 'fdm',
    buildVolumeMM: { x: 330, y: 240, z: 300 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.06, 0.3],
    internalThreadClearanceMM: 0.25,
  },
  {
    id: 'elegoo-saturn-3',
    name: 'Elegoo Saturn 3 (resin)',
    manufacturer: 'Elegoo',
    class: 'resin',
    buildVolumeMM: { x: 218, y: 122, z: 250 },
    nozzleDiameterMM: 0.03,
    layerHeightRangeMM: [0.02, 0.1],
    internalThreadClearanceMM: 0.1,
  },
  {
    id: 'formlabs-form4',
    name: 'Formlabs Form 4 (resin)',
    manufacturer: 'Formlabs',
    class: 'resin',
    buildVolumeMM: { x: 200, y: 125, z: 210 },
    nozzleDiameterMM: 0.025,
    layerHeightRangeMM: [0.025, 0.1],
    internalThreadClearanceMM: 0.1,
  },
];

export function findPrinterProfile(id: string | null | undefined): PrinterProfile {
  return PRINTER_PROFILES.find((p) => p.id === id) ?? PRINTER_PROFILES[0];
}

/**
 * Thread mesh resolution tuned to what this printer can actually reproduce:
 * radial facets sized to the nozzle/spot width (finer machines get a finer
 * mesh; a coarse nozzle gains nothing from more facets than it can print),
 * and helical height rings tied to the printer's typical layer height.
 */
export function recommendedThreadResolution(
  profile: PrinterProfile,
  majorDiameterMM: number,
  pitchMM: number,
): { radialSegments: number; ringsPerPitch: number } {
  const facetTargetMM = profile.class === 'resin' ? 0.15 : Math.max(profile.nozzleDiameterMM * 0.6, 0.15);
  const radialSegments = Math.min(64, Math.max(16, Math.round((Math.PI * majorDiameterMM) / facetTargetMM)));

  const layerHeightMM = (profile.layerHeightRangeMM[0] + profile.layerHeightRangeMM[1]) / 2;
  const ringsPerPitch = Math.min(24, Math.max(4, Math.round(pitchMM / layerHeightMM)));

  return { radialSegments, ringsPerPitch };
}

/** A practical heads-up when a thread is too fine for this printer to resolve well. */
export function threadPrintabilityWarning(profile: PrinterProfile, majorDiameterMM: number, pitchMM: number): string | null {
  if (profile.class === 'resin') return null; // resin resolves hobby-scale threads without practical issue

  const crestFlatWidthMM = pitchMM / 8; // matches threadGeometry.ts's crest truncation
  if (crestFlatWidthMM < profile.nozzleDiameterMM * 0.5) {
    return `Thread pitch is finer than the ${profile.name} (${profile.nozzleDiameterMM}mm nozzle) can resolve cleanly — expect a rounded-off, weak thread.`;
  }
  if (majorDiameterMM < profile.nozzleDiameterMM * 8) {
    return `Small for FDM on a ${profile.nozzleDiameterMM}mm nozzle — a threaded insert is usually more reliable below ~M4/#8.`;
  }
  return null;
}
