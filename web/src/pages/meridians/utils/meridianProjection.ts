/**
 * 经络路径投影 - 高效贴合模型表面
 * 
 * 算法特点：
 * 1. 直接投影原始路径点到表面（类似 lu-calibrator-ultra.html）
 * 2. 在曲线段之间插值额外点，确保贴合度
 * 3. 性能优化：使用缓存和批量处理
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Vec3 } from '../data/types';

export interface MergedBVH {
  geometry: THREE.BufferGeometry;
  bvh: MeshBVH;
  needSwapYZ: boolean;
}

let cachedMergedBVH: MergedBVH | null = null;
let cachedModelType: string | null = null;

/**
 * 从模型组构建 BVH（与校准工具一致）
 * 每个模型类型有独立的缓存
 */
export function buildBVHForModel(group: THREE.Group, modelType?: string): MergedBVH | null {
  // 如果模型类型改变，清除旧缓存
  if (modelType && modelType !== cachedModelType) {
    if (cachedMergedBVH) {
      cachedMergedBVH.geometry.dispose();
      cachedMergedBVH = null;
    }
    cachedModelType = modelType;
  }

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

  // 自动检测坐标系（与校准工具一致）
  const bbox = new THREE.Box3();
  bbox.setFromBufferAttribute(mergedGeo.getAttribute('position') as THREE.BufferAttribute);
  const yRange = bbox.max.y - bbox.min.y;
  const zRange = Math.abs(bbox.max.z - bbox.min.z);
  const needSwapYZ = zRange > 1.0 && yRange < 0.5;

  cachedMergedBVH = { geometry: mergedGeo, bvh, needSwapYZ };
  return cachedMergedBVH;
}

// 可重用的临时对象（性能优化）
const _queryPt = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * 获取平滑法线（重心坐标插值）
 */
function getSmoothNormal(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  surfacePoint: THREE.Vector3,
): THREE.Vector3 {
  const idxAttr = geometry.index;
  const posAttr = geometry.getAttribute('position');
  const normalAttr = geometry.getAttribute('normal');

  if (!idxAttr || !posAttr || faceIndex < 0) return _normal.set(0, 1, 0);

  const i0 = idxAttr.getX(faceIndex * 3);
  const i1 = idxAttr.getX(faceIndex * 3 + 1);
  const i2 = idxAttr.getX(faceIndex * 3 + 2);
  _a.fromBufferAttribute(posAttr, i0);
  _b.fromBufferAttribute(posAttr, i1);
  _c.fromBufferAttribute(posAttr, i2);

  if (!normalAttr) {
    return _normal.crossVectors(
      _v0.subVectors(_b, _a),
      _v1.subVectors(_c, _a),
    ).normalize();
  }

  // 重心坐标插值
  _v0.subVectors(_b, _a);
  _v1.subVectors(_c, _a);
  _v2.subVectors(surfacePoint, _a);
  const d00 = _v0.dot(_v0);
  const d01 = _v0.dot(_v1);
  const d11 = _v1.dot(_v1);
  const d20 = _v2.dot(_v0);
  const d21 = _v2.dot(_v1);
  const denom = d00 * d11 - d01 * d01;
  const bv = denom !== 0 ? (d11 * d20 - d01 * d21) / denom : 1 / 3;
  const bw = denom !== 0 ? (d00 * d21 - d01 * d20) / denom : 1 / 3;
  const bu = 1 - bv - bw;

  const na = _v0.fromBufferAttribute(normalAttr, i0);
  const nb = _v1.fromBufferAttribute(normalAttr, i1);
  const nc = _v2.fromBufferAttribute(normalAttr, i2);

  return _normal.set(
    na.x * bu + nb.x * bv + nc.x * bw,
    na.y * bu + nb.y * bv + nc.y * bw,
    na.z * bu + nb.z * bv + nc.z * bw,
  ).normalize();
}

/**
 * 单点投影到表面（与 lu-calibrator-ultra.html 的 snapToSurface 一致）
 */
function snapPointToSurface(
  point: Vec3,
  bvh: MeshBVH,
  geometry: THREE.BufferGeometry,
  needSwapYZ: boolean,
  offset: number,
): Vec3 {
  // 转换到 BVH 空间
  if (needSwapYZ) {
    _queryPt.set(point[0], point[2], -point[1]);
  } else {
    _queryPt.set(point[0], point[1], point[2]);
  }

  const target = { point: new THREE.Vector3(), distance: Infinity, faceIndex: 0 };
  bvh.closestPointToPoint(_queryPt, target);
  if (target.distance === Infinity || !target.point) return point;

  const surfacePoint = target.point.clone();

  // 获取平滑法线
  const normal = (target.faceIndex !== undefined && target.faceIndex >= 0)
    ? getSmoothNormal(geometry, target.faceIndex, surfacePoint)
    : _normal.subVectors(_queryPt, surfacePoint).normalize();

  if (normal.lengthSq() < 0.0001) normal.set(0, 1, 0);

  // 沿法线偏移
  surfacePoint.add(normal.multiplyScalar(offset));

  // 转换回渲染空间
  if (needSwapYZ) {
    return [surfacePoint.x, -surfacePoint.z, surfacePoint.y];
  }
  return [surfacePoint.x, surfacePoint.y, surfacePoint.z];
}

/**
 * 路径投影到表面 - 高效算法
 * 
 * 策略：
 * 1. 先投影所有原始控制点到表面
 * 2. 在相邻投影点之间插值，确保曲线段也贴合表面
 * 3. 控制插值密度以平衡质量和性能
 */
export function projectMeridianPath(
  path: Vec3[],
  merged: MergedBVH,
  offset = 0.008,  // 表面偏移量（与校准工具一致）
  maxSegmentLength = 0.05,  // 最大段长度，超过则插值
): Vec3[] {
  const { bvh, geometry, needSwapYZ } = merged;
  if (path.length < 2) return path;

  // 步骤1：投影所有原始控制点
  const projectedControlPoints = path.map(p =>
    snapPointToSurface(p, bvh, geometry, needSwapYZ, offset),
  );

  // 步骤2：在控制点之间插值，确保曲线贴合
  const result: Vec3[] = [projectedControlPoints[0]];

  for (let i = 1; i < projectedControlPoints.length; i++) {
    const prev = projectedControlPoints[i - 1];
    const curr = projectedControlPoints[i];

    // 计算段长度
    const dx = curr[0] - prev[0];
    const dy = curr[1] - prev[1];
    const dz = curr[2] - prev[2];
    const segmentLen = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // 如果段太长，插入中间点
    if (segmentLen > maxSegmentLength) {
      const numSegments = Math.ceil(segmentLen / maxSegmentLength);
      for (let j = 1; j < numSegments; j++) {
        const t = j / numSegments;
        const interpPoint: Vec3 = [
          prev[0] + dx * t,
          prev[1] + dy * t,
          prev[2] + dz * t,
        ];
        // 投影插值点到表面
        result.push(snapPointToSurface(interpPoint, bvh, geometry, needSwapYZ, offset));
      }
    }

    result.push(curr);
  }

  return result;
}

export function disposeBVH(): void {
  if (cachedMergedBVH) {
    cachedMergedBVH.geometry.dispose();
    cachedMergedBVH = null;
  }
}
