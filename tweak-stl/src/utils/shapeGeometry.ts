import * as THREE from 'three';
import type { BasicShape } from '@/state/useAppStore';

export interface BasicShapeParams {
  width: number;
  depth: number;
  height: number;
  diameter: number;
  tubeDiameter: number;
}

const RADIAL_SEGMENTS = 48;

/**
 * Builds a standalone-part-ready geometry for one of the basic shape
 * toolbox items, centered on its own local origin and oriented so its
 * "up" axis (height/thickness) runs along Z, matching how the rest of the
 * app treats Z as vertical (build-plate) up.
 */
export function createBasicShapeGeometry(shape: BasicShape, p: BasicShapeParams): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry;

  switch (shape) {
    case 'box':
      geometry = new THREE.BoxGeometry(p.width, p.depth, p.height);
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(p.diameter / 2, p.diameter / 2, p.height, RADIAL_SEGMENTS);
      geometry.rotateX(Math.PI / 2);
      break;
    case 'sphere':
      geometry = new THREE.SphereGeometry(p.diameter / 2, RADIAL_SEGMENTS, Math.max(16, RADIAL_SEGMENTS / 2));
      break;
    case 'cone':
      geometry = new THREE.ConeGeometry(p.diameter / 2, p.height, RADIAL_SEGMENTS);
      geometry.rotateX(Math.PI / 2);
      break;
    case 'pyramid':
      // A 4-sided cone approximates a square pyramid; rotate 45° so its
      // faces (not edges) align with the X/Y axes, matching a block's faces.
      geometry = new THREE.ConeGeometry(p.diameter / 2, p.height, 4);
      geometry.rotateY(Math.PI / 4);
      geometry.rotateX(Math.PI / 2);
      break;
    case 'torus': {
      const outerRadius = p.diameter / 2;
      const tubeRadius = p.tubeDiameter / 2;
      geometry = new THREE.TorusGeometry(Math.max(outerRadius - tubeRadius, 0.1), tubeRadius, Math.max(16, RADIAL_SEGMENTS / 2), RADIAL_SEGMENTS);
      break;
    }
    default:
      geometry = new THREE.BoxGeometry(p.width, p.depth, p.height);
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export const BASIC_SHAPE_LABELS: Record<BasicShape, string> = {
  box: 'Cube',
  cylinder: 'Cylinder',
  sphere: 'Sphere',
  cone: 'Cone',
  pyramid: 'Pyramid',
  torus: 'Torus',
};
