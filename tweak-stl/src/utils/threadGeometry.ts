import * as THREE from 'three';

/**
 * Shared 60° V-thread fundamental geometry (ISO 68-1 for metric threads,
 * ASME B1.1 for Unified inch threads — both standards define the same
 * triangular profile, only nominal diameter/pitch values differ):
 *
 *   H = (√3⁄2)·P                     full fundamental-triangle height
 *   pitch diameter  = D − 0.649519·P  (crest truncated H/8, i.e. 3H/8 per side)
 *   minor diameter  = D − 1.082532·P  (root also truncated H/4, i.e. 5H/8 per side)
 *
 * An internal (tapped-hole/nut) thread and an external (screw/stud) thread
 * are the same nominal profile — a tap cuts a hole with the mating
 * (negative) shape of the bolt it's sized for. So one generator produces
 * a solid "threaded rod": union it onto a surface for an external thread,
 * or subtract it from solid material for an internal one.
 */
const SQRT3_OVER_2 = 0.8660254037844387;

function engagedDepthMM(pitchMM: number): number {
  const H = SQRT3_OVER_2 * pitchMM;
  return (5 / 8) * H; // 0.541266 * P per side -> 1.082532 * P across the diameter
}

/** Radius of the V-thread profile at unwrapped axial position `u` (period = pitch). */
function profileRadius(u: number, pitchMM: number, majorR: number, minorR: number): number {
  const wrapped = ((u % pitchMM) + pitchMM) % pitchMM;
  const half = pitchMM / 2;
  const d = wrapped <= half ? wrapped : pitchMM - wrapped; // 0 at crest, `half` at root
  const crestHalfWidth = pitchMM / 16; // crest truncation H/8 -> P/8 wide
  const rootHalfWidth = pitchMM / 8; // root truncation H/4 -> P/4 wide
  if (d <= crestHalfWidth) return majorR;
  if (d >= half - rootHalfWidth) return minorR;
  const t = (d - crestHalfWidth) / (half - rootHalfWidth - crestHalfWidth);
  return majorR + (minorR - majorR) * t;
}

export interface ThreadGeometryOptions {
  majorDiameterMM: number;
  pitchMM: number;
  lengthMM: number;
  /** Vertex samples around the circumference of each ring. */
  radialSegments?: number;
  /** Height-resolution rings sampled per one full pitch/turn. */
  ringsPerPitch?: number;
}

/**
 * Builds a solid, watertight helical V-thread "rod": a plain cylinder whose
 * radius varies with a standard 60° thread profile that spirals along its
 * length. Centered on its own axis (spans z ∈ [-length/2, length/2]) to
 * match how the app's smooth-cylinder cutters are positioned.
 */
export function createThreadedRodGeometry(options: ThreadGeometryOptions): THREE.BufferGeometry {
  const { majorDiameterMM, pitchMM, lengthMM } = options;
  const radialSegments = Math.max(12, Math.round(options.radialSegments ?? 24));
  const ringsPerPitch = Math.max(4, Math.round(options.ringsPerPitch ?? 8));

  const majorR = majorDiameterMM / 2;
  const minorR = Math.max(0.05, majorR - engagedDepthMM(pitchMM));

  const turns = Math.max(1, lengthMM / pitchMM);
  const heightSegments = Math.max(2, Math.ceil(turns * ringsPerPitch));
  const vertsPerRing = radialSegments + 1;
  const halfLength = lengthMM / 2;

  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= heightSegments; i++) {
    const z = (i / heightSegments) * lengthMM - halfLength;
    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * Math.PI * 2;
      // Un-rotate the helix: at a fixed height, sweeping theta by a full
      // turn traces exactly one pitch of axial travel along the thread.
      const phase = z - (theta / (Math.PI * 2)) * pitchMM;
      const r = profileRadius(phase, pitchMM, majorR, minorR);
      positions.push(r * Math.cos(theta), r * Math.sin(theta), z);
    }
  }

  // Side wall. Winding verified so (edge1 × edge2) points radially outward:
  // triangle (a, c, b) with a=(i,j), c=(i,j+1), b=(i+1,j).
  for (let i = 0; i < heightSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * vertsPerRing + j;
      const b = a + vertsPerRing;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, c, b);
      indices.push(c, d, b);
    }
  }

  // End caps: fan from a center point, wound so normals face outward
  // (down at z = -halfLength, up at z = +halfLength).
  const bottomCenter = positions.length / 3;
  positions.push(0, 0, -halfLength);
  for (let j = 0; j < radialSegments; j++) {
    indices.push(bottomCenter, j + 1, j);
  }

  const topRingStart = heightSegments * vertsPerRing;
  const topCenter = positions.length / 3;
  positions.push(0, 0, halfLength);
  for (let j = 0; j < radialSegments; j++) {
    indices.push(topCenter, topRingStart + j, topRingStart + j + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
