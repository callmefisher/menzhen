import { useRef, useMemo } from 'react';
import * as THREE from 'three';

interface HumanBodyModelProps {
  transparency: 'full' | 'semi' | 'opaque';
}

// Programmatic human body model using basic geometries
// Can be replaced with a glTF model later
export default function HumanBodyModel({ transparency }: HumanBodyModelProps) {
  const groupRef = useRef<THREE.Group>(null);

  const materialProps = useMemo(() => {
    switch (transparency) {
      case 'full':
        return { opacity: 0, transparent: true, wireframe: true, visible: false };
      case 'semi':
        return { opacity: 0.3, transparent: true, wireframe: false, visible: true };
      case 'opaque':
        return { opacity: 1.0, transparent: false, wireframe: false, visible: true };
    }
  }, [transparency]);

  const wireframeVisible = transparency === 'full';

  // Body part definitions with position, scale, geometry type
  const bodyParts = useMemo(() => [
    // Head
    { name: 'head', pos: [0, 1.55, 0] as const, args: [0.09, 16, 16] as const, type: 'sphere' as const },
    // Neck
    { name: 'neck', pos: [0, 1.42, 0] as const, args: [0.04, 0.04, 0.08, 8] as const, type: 'cylinder' as const },
    // Torso upper
    { name: 'torso_upper', pos: [0, 1.25, 0] as const, args: [0.18, 0.15, 0.12, 0.25] as const, type: 'box' as const },
    // Torso lower
    { name: 'torso_lower', pos: [0, 1.0, 0] as const, args: [0.15, 0.12, 0.10, 0.25] as const, type: 'box' as const },
    // Pelvis
    { name: 'pelvis', pos: [0, 0.82, 0] as const, args: [0.15, 0.12, 0.10, 0.10] as const, type: 'box' as const },

    // Left upper arm
    { name: 'l_upper_arm', pos: [-0.28, 1.25, 0] as const, args: [0.035, 0.035, 0.25, 8] as const, type: 'cylinder' as const, rot: [0, 0, 0.15] as const },
    // Left forearm
    { name: 'l_forearm', pos: [-0.38, 1.0, 0] as const, args: [0.03, 0.025, 0.25, 8] as const, type: 'cylinder' as const, rot: [0, 0, 0.1] as const },
    // Left hand
    { name: 'l_hand', pos: [-0.44, 0.78, 0] as const, args: [0.035, 0.02, 0.07] as const, type: 'box' as const },

    // Right upper arm
    { name: 'r_upper_arm', pos: [0.28, 1.25, 0] as const, args: [0.035, 0.035, 0.25, 8] as const, type: 'cylinder' as const, rot: [0, 0, -0.15] as const },
    // Right forearm
    { name: 'r_forearm', pos: [0.38, 1.0, 0] as const, args: [0.03, 0.025, 0.25, 8] as const, type: 'cylinder' as const, rot: [0, 0, -0.1] as const },
    // Right hand
    { name: 'r_hand', pos: [0.44, 0.78, 0] as const, args: [0.035, 0.02, 0.07] as const, type: 'box' as const },

    // Left upper leg
    { name: 'l_upper_leg', pos: [-0.08, 0.6, 0] as const, args: [0.05, 0.045, 0.35, 8] as const, type: 'cylinder' as const },
    // Left lower leg
    { name: 'l_lower_leg', pos: [-0.08, 0.25, 0] as const, args: [0.04, 0.035, 0.35, 8] as const, type: 'cylinder' as const },
    // Left foot
    { name: 'l_foot', pos: [-0.08, 0.03, 0.03] as const, args: [0.04, 0.03, 0.10] as const, type: 'box' as const },

    // Right upper leg
    { name: 'r_upper_leg', pos: [0.08, 0.6, 0] as const, args: [0.05, 0.045, 0.35, 8] as const, type: 'cylinder' as const },
    // Right lower leg
    { name: 'r_lower_leg', pos: [0.08, 0.25, 0] as const, args: [0.04, 0.035, 0.35, 8] as const, type: 'cylinder' as const },
    // Right foot
    { name: 'r_foot', pos: [0.08, 0.03, 0.03] as const, args: [0.04, 0.03, 0.10] as const, type: 'box' as const },
  ], []);

  // Skeleton wireframe (always visible in 'full' mode)
  const skeletonLines = useMemo(() => {
    const points: [number, number, number][][] = [
      // Spine
      [[0, 0.82, 0], [0, 1.0, 0], [0, 1.25, 0], [0, 1.42, 0], [0, 1.55, 0]],
      // Left arm
      [[0, 1.35, 0], [-0.20, 1.35, 0], [-0.28, 1.25, 0], [-0.38, 1.0, 0], [-0.44, 0.78, 0]],
      // Right arm
      [[0, 1.35, 0], [0.20, 1.35, 0], [0.28, 1.25, 0], [0.38, 1.0, 0], [0.44, 0.78, 0]],
      // Left leg
      [[-0.08, 0.82, 0], [-0.08, 0.6, 0], [-0.08, 0.25, 0], [-0.08, 0.03, 0.03]],
      // Right leg
      [[0.08, 0.82, 0], [0.08, 0.6, 0], [0.08, 0.25, 0], [0.08, 0.03, 0.03]],
      // Shoulders
      [[-0.20, 1.35, 0], [0.20, 1.35, 0]],
      // Hips
      [[-0.08, 0.82, 0], [0.08, 0.82, 0]],
      // Ribcage hints
      [[-0.15, 1.15, 0.08], [0, 1.20, 0.10], [0.15, 1.15, 0.08]],
      [[-0.14, 1.05, 0.08], [0, 1.10, 0.10], [0.14, 1.05, 0.08]],
    ];
    return points;
  }, []);

  return (
    <group ref={groupRef}>
      {/* Skin/body mesh */}
      {bodyParts.map((part) => {
        const position = new THREE.Vector3(...part.pos);
        const rotation = part.rot
          ? new THREE.Euler(...(part.rot as [number, number, number]))
          : undefined;

        return (
          <mesh
            key={part.name}
            position={position}
            rotation={rotation}
            visible={materialProps.visible}
          >
            {part.type === 'sphere' && (
              <sphereGeometry args={part.args as [number, number, number]} />
            )}
            {part.type === 'cylinder' && (
              <cylinderGeometry args={part.args as [number, number, number, number]} />
            )}
            {part.type === 'box' && (
              <boxGeometry args={part.args as [number, number, number]} />
            )}
            <meshStandardMaterial
              color="#f5d6c3"
              opacity={materialProps.opacity}
              transparent={materialProps.transparent}
              side={THREE.DoubleSide}
              depthWrite={!materialProps.transparent}
            />
          </mesh>
        );
      })}

      {/* Skeleton wireframe */}
      {wireframeVisible && skeletonLines.map((linePoints, idx) => {
        const points = linePoints.map(p => new THREE.Vector3(...p));
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return (
          <lineSegments key={`skel-${idx}`} geometry={geometry}>
            <lineBasicMaterial color="#88ccff" linewidth={2} opacity={0.8} transparent />
          </lineSegments>
        );
      })}

      {/* Joint markers for skeleton mode */}
      {wireframeVisible && [
        [0, 1.55, 0], [0, 1.42, 0], [0, 1.35, 0], [0, 1.25, 0], [0, 1.0, 0], [0, 0.82, 0],
        [-0.20, 1.35, 0], [-0.28, 1.25, 0], [-0.38, 1.0, 0], [-0.44, 0.78, 0],
        [0.20, 1.35, 0], [0.28, 1.25, 0], [0.38, 1.0, 0], [0.44, 0.78, 0],
        [-0.08, 0.82, 0], [-0.08, 0.6, 0], [-0.08, 0.25, 0], [-0.08, 0.03, 0.03],
        [0.08, 0.82, 0], [0.08, 0.6, 0], [0.08, 0.25, 0], [0.08, 0.03, 0.03],
      ].map((pos, i) => (
        <mesh key={`joint-${i}`} position={new THREE.Vector3(...(pos as [number, number, number]))}>
          <sphereGeometry args={[0.012, 8, 8]} />
          <meshBasicMaterial color="#88ccff" />
        </mesh>
      ))}
    </group>
  );
}
