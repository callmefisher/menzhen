import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { MeridianData, Vec3 } from './data/types';
import type { MergedBVH } from './utils/surfaceProjection';
import { projectPathToSurface } from './utils/surfaceProjection';

interface MeridianPathProps {
  data: MeridianData;
  mergedBVH?: MergedBVH | null;
}

// Custom shader for flow animation
const flowVertexShader = `
  precision mediump float;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const flowFragmentShader = `
  precision mediump float;
  uniform float time;
  uniform vec3 color;
  uniform float opacity;
  varying vec2 vUv;

  void main() {
    float flow = fract(vUv.x * 3.0 - time * 0.5);
    float intensity = smoothstep(0.0, 0.3, flow) * smoothstep(1.0, 0.7, flow);
    float pulse = 0.8 + 0.2 * sin(time * 2.0);
    float alpha = (0.3 + intensity * 0.7) * opacity * pulse;
    gl_FragColor = vec4(color, alpha);
  }
`;

const internalFragmentShader = `
  precision mediump float;
  uniform float time;
  uniform vec3 color;
  uniform float opacity;
  varying vec2 vUv;

  void main() {
    float dash = step(0.5, fract(vUv.x * 10.0));
    float flow = fract(vUv.x * 3.0 - time * 0.5);
    float intensity = smoothstep(0.0, 0.3, flow) * smoothstep(1.0, 0.7, flow);
    float alpha = (0.15 + intensity * 0.35) * opacity * dash;
    gl_FragColor = vec4(color, alpha);
  }
`;

function createTubePath(points: Vec3[]): THREE.CatmullRomCurve3 {
  const vectors = points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  return new THREE.CatmullRomCurve3(vectors, false, 'catmullrom', 0.5);
}

function computeTubularSegments(points: Vec3[]): number {
  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    const dz = points[i][2] - points[i - 1][2];
    totalLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return Math.min(200, Math.max(20, Math.round(totalLen * 40)));
}

function FlowTube({
  points,
  color,
  isInternal = false,
  mergedBVH,
}: {
  points: Vec3[];
  color: string;
  isInternal?: boolean;
  mergedBVH?: MergedBVH | null;
}) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const colorVec = useMemo(() => new THREE.Color(color), [color]);

  // Project external paths onto model surface; skip internal paths
  const projectedPoints = useMemo(() => {
    if (!mergedBVH || isInternal || points.length < 2) return points;
    return projectPathToSurface(points, mergedBVH, 0.006);
  }, [points, mergedBVH, isInternal]);

  const geometry = useMemo(() => {
    if (projectedPoints.length < 2) return null;
    const curve = createTubePath(projectedPoints);
    const tubularSegments = computeTubularSegments(projectedPoints);
    const radius = isInternal ? 0.002 : 0.0025;
    return new THREE.TubeGeometry(curve, tubularSegments, radius, 8, false);
  }, [projectedPoints, isInternal]);

  const uniforms = useMemo(
    () => ({
      time: { value: 0 },
      color: { value: colorVec },
      opacity: { value: 1.0 },
    }),
    [colorVec],
  );

  useFrame((_, delta) => {
    if (materialRef.current) {
      materialRef.current.uniforms.time.value += delta;
    }
  });

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} renderOrder={isInternal ? 1 : 2}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={flowVertexShader}
        fragmentShader={isInternal ? internalFragmentShader : flowFragmentShader}
        uniforms={uniforms}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
        depthTest
      />
    </mesh>
  );
}

export default function MeridianPath({ data, mergedBVH }: MeridianPathProps) {
  return (
    <group>
      {data.path.length >= 2 && (
        <FlowTube points={data.path} color={data.color} mergedBVH={mergedBVH} />
      )}
      {data.internalPath && data.internalPath.length >= 2 && (
        <FlowTube points={data.internalPath} color={data.color} isInternal mergedBVH={mergedBVH} />
      )}
    </group>
  );
}
