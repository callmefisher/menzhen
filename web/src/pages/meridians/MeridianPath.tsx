import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { MeridianData } from './data/types';

interface MeridianPathProps {
  data: MeridianData;
}

// Custom shader for flow animation
const flowVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const flowFragmentShader = `
  uniform float time;
  uniform vec3 color;
  uniform float opacity;
  varying vec2 vUv;

  void main() {
    // Create flowing light band effect
    float flow = fract(vUv.x * 3.0 - time * 0.5);
    float intensity = smoothstep(0.0, 0.3, flow) * smoothstep(1.0, 0.7, flow);

    // Add a subtle glow pulse
    float pulse = 0.8 + 0.2 * sin(time * 2.0);

    float alpha = (0.3 + intensity * 0.7) * opacity * pulse;
    gl_FragColor = vec4(color, alpha);
  }
`;

const internalFragmentShader = `
  uniform float time;
  uniform vec3 color;
  uniform float opacity;
  varying vec2 vUv;

  void main() {
    // Dashed effect for internal path
    float dash = step(0.5, fract(vUv.x * 10.0));

    // Flow animation (dimmer than external)
    float flow = fract(vUv.x * 3.0 - time * 0.5);
    float intensity = smoothstep(0.0, 0.3, flow) * smoothstep(1.0, 0.7, flow);

    float alpha = (0.15 + intensity * 0.35) * opacity * dash;
    gl_FragColor = vec4(color, alpha);
  }
`;

function createTubePath(points: [number, number, number][]): THREE.CatmullRomCurve3 {
  const vectors = points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  return new THREE.CatmullRomCurve3(vectors, false, 'catmullrom', 0.5);
}

function FlowTube({
  points,
  color,
  isInternal = false,
}: {
  points: [number, number, number][];
  color: string;
  isInternal?: boolean;
}) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const colorVec = useMemo(() => new THREE.Color(color), [color]);

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const curve = createTubePath(points);
    return new THREE.TubeGeometry(curve, points.length * 4, isInternal ? 0.004 : 0.005, 8, false);
  }, [points, isInternal]);

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
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={flowVertexShader}
        fragmentShader={isInternal ? internalFragmentShader : flowFragmentShader}
        uniforms={uniforms}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

export default function MeridianPath({ data }: MeridianPathProps) {
  return (
    <group>
      {/* External (surface) path */}
      {data.path.length >= 2 && (
        <FlowTube points={data.path} color={data.color} />
      )}

      {/* Internal path */}
      {data.internalPath && data.internalPath.length >= 2 && (
        <FlowTube points={data.internalPath} color={data.color} isInternal />
      )}
    </group>
  );
}
