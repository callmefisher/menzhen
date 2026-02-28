/**
 * Surface projection utilities using three-mesh-bvh for raycasting acceleration.
 *
 * Provides functions to:
 * 1. Build a BVH for a skinned mesh (one-time cost at model load)
 * 2. Project 3D guide-points onto the nearest model surface
 * 3. Offset projected points along surface normal (so paths sit *on* the skin)
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Vec3 } from '../data/types';

// ── Types ──────────────────────────────────────────────────────────

export interface ProjectionResult {
  /** Surface point (world-space) */
  point: THREE.Vector3;
  /** Surface normal at that point (world-space) */
  normal: THREE.Vector3;
  /** Distance from the original guide point to the surface */
  distance: number;
}

// ── BVH cache ──────────────────────────────────────────────────────

// Store BVH separately to avoid type conflicts with drei's boundsTree
const bvhCache = new WeakMap<THREE.BufferGeometry, MeshBVH>();

// ── BVH builder ────────────────────────────────────────────────────

/**
 * Find the largest mesh inside a model group and build BVH for it.
 * Returns the mesh (with BVH cached) or null if no mesh found.
 */
export function buildBVHForModel(group: THREE.Group): THREE.Mesh | null {
  let bestMesh: THREE.Mesh | null = null;
  let bestVertexCount = 0;

  group.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const posAttr = child.geometry.getAttribute('position');
      if (posAttr && posAttr.count > bestVertexCount) {
        bestVertexCount = posAttr.count;
        bestMesh = child;
      }
    }
  });

  if (!bestMesh) return null;

  const mesh = bestMesh as THREE.Mesh;
  mesh.updateWorldMatrix(true, false);

  // Build BVH acceleration structure and cache it
  const bvh = new MeshBVH(mesh.geometry);
  bvhCache.set(mesh.geometry, bvh);

  return mesh;
}

// ── Projection ─────────────────────────────────────────────────────

const _inverseMatrix = new THREE.Matrix4();

/**
 * Project a single world-space point onto the nearest surface of the BVH mesh.
 */
export function projectPointToSurface(
  point: THREE.Vector3,
  mesh: THREE.Mesh,
): ProjectionResult | null {
  const bvh = bvhCache.get(mesh.geometry);
  if (!bvh) return null;

  // Transform point into mesh local space
  _inverseMatrix.copy(mesh.matrixWorld).invert();
  const localPoint = point.clone().applyMatrix4(_inverseMatrix);

  // Find closest point on surface
  const hit = bvh.closestPointToPoint(localPoint);
  if (!hit) return null;

  // Transform hit point back to world space
  const worldPoint = hit.point.clone().applyMatrix4(mesh.matrixWorld);

  // Compute surface normal from face
  const normal = new THREE.Vector3();
  if (hit.faceIndex !== undefined && hit.faceIndex >= 0) {
    const indexAttr = mesh.geometry.index;
    const posAttr = mesh.geometry.getAttribute('position');
    if (indexAttr && posAttr) {
      const i0 = indexAttr.getX(hit.faceIndex * 3);
      const i1 = indexAttr.getX(hit.faceIndex * 3 + 1);
      const i2 = indexAttr.getX(hit.faceIndex * 3 + 2);
      const a = new THREE.Vector3().fromBufferAttribute(posAttr, i0);
      const b = new THREE.Vector3().fromBufferAttribute(posAttr, i1);
      const c = new THREE.Vector3().fromBufferAttribute(posAttr, i2);
      normal.crossVectors(
        new THREE.Vector3().subVectors(b, a),
        new THREE.Vector3().subVectors(c, a),
      ).normalize();
      // Transform normal to world space (rotation only)
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      normal.applyMatrix3(normalMatrix).normalize();
    }
  }

  // Fallback: direction from surface toward the guide point
  if (normal.lengthSq() < 0.01) {
    normal.subVectors(point, worldPoint).normalize();
  }

  return {
    point: worldPoint,
    normal,
    distance: point.distanceTo(worldPoint),
  };
}

/**
 * Project an array of guide points onto the model surface, then offset by
 * a given amount along the surface normal.
 *
 * @param guidePoints  Coarse guide coordinates (world-space Y-up)
 * @param mesh         The BVH-enabled skin mesh
 * @param normalOffset How far to push points outward from the surface (meters)
 * @returns            Projected + offset points as Vec3[]
 */
export function projectPathToSurface(
  guidePoints: Vec3[],
  mesh: THREE.Mesh,
  normalOffset = 0.004,
): Vec3[] {
  return guidePoints.map((gp) => {
    const worldPt = new THREE.Vector3(gp[0], gp[1], gp[2]);
    const result = projectPointToSurface(worldPt, mesh);
    if (!result) return gp; // fallback to original

    const projected = result.point.add(result.normal.multiplyScalar(normalOffset));
    return [projected.x, projected.y, projected.z] as Vec3;
  });
}

/**
 * Dispose of the cached BVH for a mesh.
 */
export function disposeBVH(mesh: THREE.Mesh): void {
  bvhCache.delete(mesh.geometry);
}
