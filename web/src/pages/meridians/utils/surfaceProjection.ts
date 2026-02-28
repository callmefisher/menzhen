/**
 * Surface projection: merge ALL meshes into world-space geometry,
 * build BVH, and auto-detect coordinate axis mapping.
 *
 * Handles the common case where GLB internal rotation causes
 * the model's height to end up in -Z instead of +Y.
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Vec3 } from '../data/types';

export interface MergedBVH {
  geometry: THREE.BufferGeometry;
  bvh: MeshBVH;
  /** True when BVH height is in Z axis (need Y↔Z swap for projection) */
  needSwapYZ: boolean;
}

let cachedMergedBVH: MergedBVH | null = null;

/**
 * Build merged world-space BVH from all meshes in the model group.
 */
export function buildBVHForModel(group: THREE.Group): MergedBVH | null {
  group.updateMatrixWorld(true);

  const allPositions: number[] = [];
  const allIndices: number[] = [];
  let vertexOffset = 0;

  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry) return;
    const posAttr = child.geometry.getAttribute('position');
    if (!posAttr) return;

    const wm = child.matrixWorld;
    const v = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i);
      v.applyMatrix4(wm);
      allPositions.push(v.x, v.y, v.z);
    }

    const idx = child.geometry.index;
    if (idx) {
      for (let i = 0; i < idx.count; i++) allIndices.push(idx.getX(i) + vertexOffset);
    } else {
      for (let i = 0; i < posAttr.count; i++) allIndices.push(i + vertexOffset);
    }
    vertexOffset += posAttr.count;
  });

  if (allPositions.length === 0) return null;

  const mergedGeo = new THREE.BufferGeometry();
  mergedGeo.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
  mergedGeo.setIndex(allIndices);

  const bvh = new MeshBVH(mergedGeo);

  // Auto-detect: is height in Y or Z?
  const bbox = new THREE.Box3();
  bbox.setFromBufferAttribute(mergedGeo.getAttribute('position') as THREE.BufferAttribute);
  const yRange = bbox.max.y - bbox.min.y;
  const zRange = Math.abs(bbox.max.z - bbox.min.z);
  const needSwapYZ = zRange > 1.0 && yRange < 0.5;

  cachedMergedBVH = { geometry: mergedGeo, bvh, needSwapYZ };
  return cachedMergedBVH;
}

// Reusable temp objects
const _tempTarget = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

/**
 * Project guide points onto the merged BVH surface with normal offset.
 * Auto-handles Y↔Z axis swap when the model's height is in -Z.
 */
export function projectPathToSurface(
  guidePoints: Vec3[],
  merged: MergedBVH,
  normalOffset = 0.006,
): Vec3[] {
  const { bvh, geometry, needSwapYZ } = merged;
  const posAttr = geometry.getAttribute('position');
  const idxAttr = geometry.index;

  return guidePoints.map((gp) => {
    // Transform guide point to BVH space
    let queryPt: THREE.Vector3;
    if (needSwapYZ) {
      // Guide: Y=height, Z=depth → BVH: Z=-height, Y=depth
      queryPt = new THREE.Vector3(gp[0], gp[2], -gp[1]);
    } else {
      queryPt = new THREE.Vector3(gp[0], gp[1], gp[2]);
    }

    const hit = bvh.closestPointToPoint(queryPt, _tempTarget);
    if (!hit) return gp;

    const surfacePoint = hit.point.clone();

    // Compute face normal
    const normal = new THREE.Vector3();
    if (hit.faceIndex !== undefined && hit.faceIndex >= 0 && idxAttr && posAttr) {
      const i0 = idxAttr.getX(hit.faceIndex * 3);
      const i1 = idxAttr.getX(hit.faceIndex * 3 + 1);
      const i2 = idxAttr.getX(hit.faceIndex * 3 + 2);
      const a = new THREE.Vector3().fromBufferAttribute(posAttr, i0);
      const b = new THREE.Vector3().fromBufferAttribute(posAttr, i1);
      const c = new THREE.Vector3().fromBufferAttribute(posAttr, i2);
      normal.crossVectors(
        new THREE.Vector3().subVectors(b, a),
        new THREE.Vector3().subVectors(c, a),
      ).normalize();
    }
    if (normal.lengthSq() < 0.01) {
      normal.subVectors(queryPt, surfacePoint).normalize();
    }

    // Offset along normal
    const projected = surfacePoint.add(normal.multiplyScalar(normalOffset));

    // Transform back to guide/render space
    if (needSwapYZ) {
      // BVH: (x, y, z) → Guide: (x, -z, y)
      return [projected.x, -projected.z, projected.y] as Vec3;
    }
    return [projected.x, projected.y, projected.z] as Vec3;
  });
}

export function disposeBVH(): void {
  if (cachedMergedBVH) {
    cachedMergedBVH.geometry.dispose();
    cachedMergedBVH = null;
  }
}
