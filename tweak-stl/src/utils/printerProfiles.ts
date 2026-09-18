export type PrinterClass = 'fdm' | 'resin';

export interface PrinterProfile {
  id: string;
  name: string;
  manufacturer: string;
  class: PrinterClass;
  buildVolumeMM: { x: number; y: number; z: number };
  /** Nozzle diameter for FDM, or effective XY pixel/laser spot size for resin. This is the machine's stock/default nozzle. */
  nozzleDiameterMM: number;
  layerHeightRangeMM: [number, number];
  /** Diametral clearance added to internal (tapped) threads so a print accepts a real bolt. */
  internalThreadClearanceMM: number;
  /**
   * Other nozzle diameters this machine can run, stock included. Empty for
   * resin (there's no user-swappable "nozzle" — the spot size is fixed by
   * the LCD/optics). For FDM this is generally the common M6/MK8-thread
   * brass-nozzle sizes the hobby industry has standardized on, which fit
   * the vast majority of consumer hotends — it's a statement about nozzle
   * manufacturing standards, not a per-model claim beyond what's verified
   * for the stock size. A couple of profiles (FlashForge's quick-swap "AD5X"
   * hotend family, Bambu's "A series" hotend) list their manufacturer's own
   * documented optional set instead, since it differs from the common one.
   */
  availableNozzleDiametersMM: number[];
}

/** The nozzle sizes most consumer FDM hotends (M6/MK8/V6-thread) are sold in. */
const STANDARD_FDM_NOZZLES_MM = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0];

/**
 * Layer height range for an arbitrary nozzle diameter, using the 20%–70%
 * of nozzle diameter rule Bambu Lab documents for its own nozzle lineup
 * (https://wiki.bambulab.com/en/software/bambu-studio/layer-height) and
 * which is the general rule of thumb used across the FDM industry. Used
 * whenever the user overrides a printer's stock nozzle with another size,
 * since a profile's own verified layerHeightRangeMM only applies at its
 * stock diameter.
 */
export function layerHeightRangeForNozzle(nozzleDiameterMM: number): [number, number] {
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return [round(nozzleDiameterMM * 0.2), round(nozzleDiameterMM * 0.7)];
}

/** Returns `profile` as-is, or with nozzle diameter (and matching layer height range) swapped to `nozzleOverrideMM`. */
export function effectivePrinterProfile(profile: PrinterProfile, nozzleOverrideMM: number | null): PrinterProfile {
  if (nozzleOverrideMM == null || nozzleOverrideMM === profile.nozzleDiameterMM) return profile;
  return { ...profile, nozzleDiameterMM: nozzleOverrideMM, layerHeightRangeMM: layerHeightRangeForNozzle(nozzleOverrideMM) };
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
    availableNozzleDiametersMM: STANDARD_FDM_NOZZLES_MM,
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
    availableNozzleDiametersMM: [0.2, 0.4, 0.6, 0.8],
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
    availableNozzleDiametersMM: [0.2, 0.4, 0.6, 0.8],
  },
  {
    id: 'bambulab-a1',
    name: 'Bambu Lab A1',
    manufacturer: 'Bambu Lab',
    class: 'fdm',
    buildVolumeMM: { x: 256, y: 256, z: 256 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.08, 0.28],
    internalThreadClearanceMM: 0.25,
    availableNozzleDiametersMM: [0.2, 0.4, 0.6, 0.8],
  },
  {
    id: 'bambulab-a1-mini',
    name: 'Bambu Lab A1 mini',
    manufacturer: 'Bambu Lab',
    class: 'fdm',
    buildVolumeMM: { x: 180, y: 180, z: 180 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.08, 0.28],
    internalThreadClearanceMM: 0.25,
    availableNozzleDiametersMM: [0.2, 0.4, 0.6, 0.8],
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
    availableNozzleDiametersMM: STANDARD_FDM_NOZZLES_MM,
  },
  {
    id: 'prusa-mini-plus',
    name: 'Prusa MINI+',
    manufacturer: 'Prusa Research',
    class: 'fdm',
    buildVolumeMM: { x: 180, y: 180, z: 180 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.05, 0.25],
    internalThreadClearanceMM: 0.25,
    availableNozzleDiametersMM: STANDARD_FDM_NOZZLES_MM,
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
    availableNozzleDiametersMM: STANDARD_FDM_NOZZLES_MM,
  },
  {
    id: 'creality-ender3-s1-pro',
    name: 'Creality Ender-3 S1 Pro',
    manufacturer: 'Creality',
    class: 'fdm',
    buildVolumeMM: { x: 220, y: 220, z: 270 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.05, 0.4],
    internalThreadClearanceMM: 0.3,
    availableNozzleDiametersMM: STANDARD_FDM_NOZZLES_MM,
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
    availableNozzleDiametersMM: STANDARD_FDM_NOZZLES_MM,
  },
  {
    id: 'creality-k1-max',
    name: 'Creality K1 Max',
    manufacturer: 'Creality',
    class: 'fdm',
    buildVolumeMM: { x: 300, y: 300, z: 300 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.1, 0.35],
    internalThreadClearanceMM: 0.3,
    availableNozzleDiametersMM: STANDARD_FDM_NOZZLES_MM,
  },
  {
    id: 'flashforge-adventurer-5m',
    name: 'FlashForge Adventurer 5M',
    manufacturer: 'FlashForge',
    class: 'fdm',
    buildVolumeMM: { x: 220, y: 220, z: 220 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.1, 0.4],
    internalThreadClearanceMM: 0.3,
    // FlashForge's own optional set for this hotend is 0.25/0.4/0.6/0.8mm
    // (not the more common 0.2mm) — https://www.flashforge.com/products/adventurer-5m-3d-printer
    availableNozzleDiametersMM: [0.25, 0.4, 0.6, 0.8],
  },
  {
    id: 'flashforge-adventurer-5m-pro',
    name: 'FlashForge Adventurer 5M Pro',
    manufacturer: 'FlashForge',
    class: 'fdm',
    buildVolumeMM: { x: 220, y: 220, z: 220 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.1, 0.4],
    internalThreadClearanceMM: 0.3,
    availableNozzleDiametersMM: [0.25, 0.4, 0.6, 0.8],
  },
  {
    id: 'anycubic-kobra-3',
    name: 'Anycubic Kobra 3',
    manufacturer: 'Anycubic',
    class: 'fdm',
    buildVolumeMM: { x: 250, y: 250, z: 260 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.1, 0.3],
    internalThreadClearanceMM: 0.3,
    availableNozzleDiametersMM: [0.2, 0.4, 0.6, 0.8],
  },
  {
    id: 'qidi-x-max-3',
    name: 'QIDI X-Max 3',
    manufacturer: 'QIDI Tech',
    class: 'fdm',
    buildVolumeMM: { x: 325, y: 325, z: 315 },
    nozzleDiameterMM: 0.4,
    layerHeightRangeMM: [0.05, 0.4],
    internalThreadClearanceMM: 0.25,
    availableNozzleDiametersMM: [0.2, 0.4, 0.6, 0.8],
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
    availableNozzleDiametersMM: STANDARD_FDM_NOZZLES_MM,
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
    // Ultimaker's AA print cores: 0.25/0.4/0.6/0.8mm.
    availableNozzleDiametersMM: [0.25, 0.4, 0.6, 0.8],
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
    availableNozzleDiametersMM: [],
  },
  {
    id: 'elegoo-saturn-4-ultra',
    name: 'Elegoo Saturn 4 Ultra (resin)',
    manufacturer: 'Elegoo',
    class: 'resin',
    buildVolumeMM: { x: 219, y: 123, z: 220 },
    nozzleDiameterMM: 0.02,
    layerHeightRangeMM: [0.01, 0.2],
    internalThreadClearanceMM: 0.1,
    availableNozzleDiametersMM: [],
  },
  {
    id: 'anycubic-photon-mono-m5s',
    name: 'Anycubic Photon Mono M5s (resin)',
    manufacturer: 'Anycubic',
    class: 'resin',
    buildVolumeMM: { x: 218.88, y: 122.88, z: 200 },
    nozzleDiameterMM: 0.02,
    layerHeightRangeMM: [0.01, 0.15],
    internalThreadClearanceMM: 0.1,
    availableNozzleDiametersMM: [],
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
    availableNozzleDiametersMM: [],
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

export interface SceneBoundsMM {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * Checks a scene's combined, absolute-position bounding box against the
 * selected printer's working volume — X/Y centered on the plate, Z
 * measured up from Z=0 — and returns a plain-language warning naming which
 * axis/axes don't fit and by how much, or null when everything fits.
 *
 * Deliberately checks actual min/max position, not just overall size: a
 * small part dragged off to one side of the plate can sit outside the
 * printable area even though it would easily fit if centered, and a
 * size-only check would miss that entirely.
 */
export function buildVolumeWarning(profile: PrinterProfile, bounds: SceneBoundsMM): string | null {
  const halfX = profile.buildVolumeMM.x / 2;
  const halfY = profile.buildVolumeMM.y / 2;
  const maxZ = profile.buildVolumeMM.z;
  const EPS = 0.01; // ignore sub-hundredth-mm float noise

  const overflow = {
    x: Math.max(0, -halfX - bounds.minX, bounds.maxX - halfX),
    y: Math.max(0, -halfY - bounds.minY, bounds.maxY - halfY),
    // Below the plate (minZ < 0) is exactly as invalid as above max height.
    z: Math.max(0, -bounds.minZ, bounds.maxZ - maxZ),
  };
  const overflowing = (['x', 'y', 'z'] as const).filter((axis) => overflow[axis] > EPS);
  if (overflowing.length === 0) return null;

  const parts = overflowing.map((axis) => `${axis.toUpperCase()} by ${overflow[axis].toFixed(1)}mm`);
  return `Exceeds the ${profile.name} build volume (${profile.buildVolumeMM.x}×${profile.buildVolumeMM.y}×${profile.buildVolumeMM.z}mm) — ${parts.join(', ')}.`;
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
