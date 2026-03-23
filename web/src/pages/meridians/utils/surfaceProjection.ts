/**
 * Surface projection: merge ALL meshes into world-space geometry,
 * build BVH, and auto-detect coordinate axis mapping.
 *
 * Multi-pass projection ensures paths tightly follow the body surface:
 * Phase 1: Project control points → surface
 * Phase 2: Resample curve at 3× density
 * Phase 3: Re-project ALL resampled points → surface
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
  mergedGeo.computeVertexNormals();

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
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * Compute barycentric-interpolated smooth normal at a surface point.
 * Falls back to face normal if vertex normals are unavailable.
 */
function getSmoothNormal(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  surfacePoint: THREE.Vector3,
): THREE.Vector3 {
  const idxAttr = geometry.index;
  const posAttr = geometry.getAttribute('position');
  const normalAttr = geometry.getAttribute('normal');
  const result = new THREE.Vector3();

  if (!idxAttr || !posAttr || faceIndex < 0) return result.set(0, 1, 0);

  const i0 = idxAttr.getX(faceIndex * 3);
  const i1 = idxAttr.getX(faceIndex * 3 + 1);
  const i2 = idxAttr.getX(faceIndex * 3 + 2);
  _a.fromBufferAttribute(posAttr, i0);
  _b.fromBufferAttribute(posAttr, i1);
  _c.fromBufferAttribute(posAttr, i2);

  if (!normalAttr) {
    result.crossVectors(
      _v0.subVectors(_b, _a),
      _v1.subVectors(_c, _a),
    ).normalize();
    return result;
  }

  // Barycentric interpolation of vertex normals
  _v0.subVectors(_b, _a);
  _v1.subVectors(_c, _a);
  _v2.subVectors(surfacePoint, _a);
  const d00 = _v0.dot(_v0);
  const d01 = _v0.dot(_v1);
  const d11 = _v1.dot(_v1);
  const d20 = _v2.dot(_v0);
  const d21 = _v2.dot(_v1);
  const denom = d00 * d11 - d01 * d01;
  const bv = denom !== 0 ? (d11 * d20 - d01 * d21) / denom : 1/3;
  const bw = denom !== 0 ? (d00 * d21 - d01 * d20) / denom : 1/3;
  const bu = 1 - bv - bw;

  const na = _v0.fromBufferAttribute(normalAttr, i0);
  const nb = _v1.fromBufferAttribute(normalAttr, i1);
  const nc = _v2.fromBufferAttribute(normalAttr, i2);

  result.set(
    na.x * bu + nb.x * bv + nc.x * bw,
    na.y * bu + nb.y * bv + nc.y * bw,
    na.z * bu + nb.z * bv + nc.z * bw,
  ).normalize();

  return result;
}

/**
 * Project a single point onto the BVH surface with normal offset.
 * Handles Y↔Z axis swap for models where height is in -Z.
 */
function projectSinglePoint(
  gp: Vec3,
  bvh: MeshBVH,
  geometry: THREE.BufferGeometry,
  needSwapYZ: boolean,
  normalOffset: number,
): Vec3 {
  if (!Number.isFinite(gp[0]) || !Number.isFinite(gp[1]) || !Number.isFinite(gp[2])) {
    return gp;
  }

  // Transform guide point to BVH space
  let queryPt: THREE.Vector3;
  if (needSwapYZ) {
    queryPt = new THREE.Vector3(gp[0], gp[2], -gp[1]);
  } else {
    queryPt = new THREE.Vector3(gp[0], gp[1], gp[2]);
  }

  const target = { point: new THREE.Vector3(), distance: Infinity, faceIndex: 0 };
  const hit = bvh.closestPointToPoint(queryPt, target);
  if (!hit || !hit.point) return gp;

  const surfacePoint = hit.point.clone();

  // Smooth normal via barycentric interpolation
  const normal = (hit.faceIndex !== undefined && hit.faceIndex >= 0)
    ? getSmoothNormal(geometry, hit.faceIndex, surfacePoint)
    : new THREE.Vector3().subVectors(queryPt, surfacePoint).normalize();

  if (normal.lengthSq() < 0.01) {
    normal.subVectors(queryPt, surfacePoint).normalize();
  }
  if (normal.lengthSq() < 0.0001) {
    normal.set(0, 1, 0);
  }

  // Offset along normal
  const projected = surfacePoint.add(normal.multiplyScalar(normalOffset));

  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) {
    return gp;
  }

  // Transform back to guide/render space
  if (needSwapYZ) {
    return [projected.x, -projected.z, projected.y] as Vec3;
  }
  return [projected.x, projected.y, projected.z] as Vec3;
}

/**
 * Project guide points onto the merged BVH surface with normal offset.
 *
 * Uses a 3-phase pipeline for tight surface adherence:
 * 1. Project original control points to surface
 * 2. Resample via CatmullRom at 3× density
 * 3. Re-project ALL resampled points to surface
 *
 * This ensures the entire path follows the body contour,
 * even on curved areas (arms, legs) where simple interpolation
 * would arc away from the surface.
 */
export function projectPathToSurface(
  guidePoints: Vec3[],
  merged: MergedBVH,
  normalOffset = 0.005,
): Vec3[] {
  const { bvh, geometry, needSwapYZ } = merged;

  // Phase 1: Project original control points to surface
  const phase1 = guidePoints.map(gp =>
    projectSinglePoint(gp, bvh, geometry, needSwapYZ, normalOffset),
  );

  // Filter valid points for curve creation
  const valid = phase1.filter(p =>
    Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]),
  );
  if (valid.length < 2) return phase1;

  // Phase 2: Resample at 3× density via CatmullRom curve
  const vectors = valid.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(vectors, false, 'centripetal', 0.5);
  const numSamples = Math.max(valid.length * 3, 60);
  const resampled = curve.getPoints(numSamples - 1);

  // Phase 3: Re-project ALL resampled points to surface
  return resampled.map(p =>
    projectSinglePoint(
      [p.x, p.y, p.z] as Vec3,
      bvh, geometry, needSwapYZ, normalOffset,
    ),
  );
}

export function disposeBVH(): void {
  if (cachedMergedBVH) {
    cachedMergedBVH.geometry.dispose();
    cachedMergedBVH = null;
  }
}
