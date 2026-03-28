import { useMemo } from 'react';
import * as THREE from 'three';
import type { MeridianData, Vec3 } from './data/types';
import type { MergedBVH } from './utils/meridianProjection';
import { projectMeridianPath } from './utils/meridianProjection';

interface MeridianPathProps {
  data: MeridianData;
  mergedBVH?: MergedBVH | null;
}

function createTubePath(points: Vec3[]): THREE.CatmullRomCurve3 {
  const vectors = points
    .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]))
    .map(p => new THREE.Vector3(p[0], p[1], p[2]));
  return new THREE.CatmullRomCurve3(vectors, false, 'catmullrom', 0.5);
}

function computeTubularSegments(points: Vec3[]): number {
  return points.length * 4;
}

function FlowTube({
  points,
  color,
  isInternal = false,
}: {
  points: Vec3[];
  color: string;
  isInternal?: boolean;
}) {
  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const curve = createTubePath(points);
    const tubularSegments = computeTubularSegments(points);
    const radius = isInternal ? 0.002 : 0.0025;
    return new THREE.TubeGeometry(curve, tubularSegments, radius, 8, false);
  }, [points, isInternal]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} renderOrder={isInternal ? 1 : 2}>
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.3}
        roughness={0.4}
        metalness={0.6}
        transparent
        opacity={0.8}
      />
    </mesh>
  );
}

export default function MeridianPath({ data, mergedBVH }: MeridianPathProps) {
  // 使用投影后的路径（如果 BVH 可用）
  const projectedPath = useMemo(() => {
    if (!mergedBVH) return data.path;
    return projectMeridianPath(data.path, mergedBVH);
  }, [data.path, mergedBVH]);

  const projectedInternalPath = useMemo(() => {
    if (!mergedBVH || !data.internalPath) return data.internalPath;
    return projectMeridianPath(data.internalPath, mergedBVH);
  }, [data.internalPath, mergedBVH]);

  return (
    <group>
      {projectedPath.length >= 2 && (
        <FlowTube points={projectedPath} color={data.color} />
      )}
      {projectedInternalPath && projectedInternalPath.length >= 2 && (
        <FlowTube points={projectedInternalPath} color={data.color} isInternal />
      )}
    </group>
  );
}
