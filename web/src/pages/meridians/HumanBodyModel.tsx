import { useMemo } from 'react';
import * as THREE from 'three';

interface HumanBodyModelProps {
  transparency: 'full' | 'semi' | 'opaque';
}

// Create a lathe geometry body part from a profile curve
function createLatheBody(profile: [number, number][], segments = 24): THREE.LatheGeometry {
  const points = profile.map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(points, segments);
}

export default function HumanBodyModel({ transparency }: HumanBodyModelProps) {
  const visible = transparency !== 'full';
  const wireframeVisible = transparency === 'full';

  const opacity = transparency === 'semi' ? 0.3 : 1.0;
  const isTransparent = transparency === 'semi';

  // Torso profile (lathe around Y axis): [radius, y]
  const torsoGeometry = useMemo(() => {
    return createLatheBody([
      [0.0, 0.78],   // pelvis bottom center
      [0.12, 0.78],  // pelvis bottom
      [0.14, 0.82],  // hips
      [0.13, 0.88],  // waist
      [0.12, 0.94],  // abdomen
      [0.13, 1.00],  // lower ribs
      [0.15, 1.06],  // ribs
      [0.17, 1.12],  // chest
      [0.18, 1.20],  // upper chest
      [0.17, 1.26],  // shoulders start
      [0.14, 1.32],  // neck base
      [0.04, 1.38],  // neck
      [0.04, 1.42],  // neck top
      [0.0, 1.42],   // neck center
    ], 32);
  }, []);

  // Head as ellipsoid
  const headGeometry = useMemo(() => {
    const geo = new THREE.SphereGeometry(0.09, 24, 20);
    // Slightly elongate vertically
    const posAttr = geo.getAttribute('position');
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      posAttr.setY(i, y * 1.15); // taller head
      // Slightly flatten front-back
      const z = posAttr.getZ(i);
      posAttr.setZ(i, z * 0.9);
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, []);

  // Skeleton lines
  const skeletonLines = useMemo(() => {
    const lines: [number, number, number][][] = [
      // Spine
      [[0, 0.78, 0], [0, 0.82, 0], [0, 0.90, 0], [0, 1.00, 0], [0, 1.10, 0], [0, 1.20, 0], [0, 1.30, 0], [0, 1.38, 0], [0, 1.42, 0], [0, 1.55, 0]],
      // Clavicles
      [[-0.20, 1.34, 0], [0, 1.34, 0], [0.20, 1.34, 0]],
      // Left arm
      [[-0.20, 1.34, 0], [-0.26, 1.28, 0], [-0.32, 1.14, 0], [-0.38, 1.00, 0], [-0.40, 0.86, 0], [-0.42, 0.78, 0], [-0.44, 0.70, 0]],
      // Right arm
      [[0.20, 1.34, 0], [0.26, 1.28, 0], [0.32, 1.14, 0], [0.38, 1.00, 0], [0.40, 0.86, 0], [0.42, 0.78, 0], [0.44, 0.70, 0]],
      // Pelvis
      [[-0.08, 0.82, 0], [0, 0.78, 0], [0.08, 0.82, 0]],
      // Left leg
      [[-0.08, 0.82, 0], [-0.08, 0.68, 0], [-0.08, 0.46, 0], [-0.08, 0.30, 0], [-0.08, 0.12, 0], [-0.08, 0.03, 0.03]],
      // Right leg
      [[0.08, 0.82, 0], [0.08, 0.68, 0], [0.08, 0.46, 0], [0.08, 0.30, 0], [0.08, 0.12, 0], [0.08, 0.03, 0.03]],
      // Ribcage (front)
      [[-0.16, 1.20, 0.08], [-0.10, 1.22, 0.10], [0, 1.24, 0.11], [0.10, 1.22, 0.10], [0.16, 1.20, 0.08]],
      [[-0.15, 1.14, 0.08], [-0.08, 1.16, 0.10], [0, 1.17, 0.10], [0.08, 1.16, 0.10], [0.15, 1.14, 0.08]],
      [[-0.14, 1.08, 0.08], [-0.07, 1.10, 0.09], [0, 1.10, 0.09], [0.07, 1.10, 0.09], [0.14, 1.08, 0.08]],
      [[-0.12, 1.02, 0.06], [0, 1.04, 0.08], [0.12, 1.02, 0.06]],
      // Ribcage (back)
      [[-0.15, 1.20, -0.06], [0, 1.20, -0.08], [0.15, 1.20, -0.06]],
      [[-0.14, 1.12, -0.06], [0, 1.12, -0.08], [0.14, 1.12, -0.06]],
      // Scapulae hints
      [[-0.16, 1.26, -0.04], [-0.12, 1.20, -0.06], [-0.16, 1.14, -0.04]],
      [[0.16, 1.26, -0.04], [0.12, 1.20, -0.06], [0.16, 1.14, -0.04]],
    ];
    return lines;
  }, []);

  // Joint positions
  const joints: [number, number, number][] = useMemo(() => [
    // Spine
    [0, 0.78, 0], [0, 0.82, 0], [0, 1.00, 0], [0, 1.20, 0], [0, 1.34, 0], [0, 1.42, 0], [0, 1.55, 0],
    // Left arm
    [-0.20, 1.34, 0], [-0.32, 1.14, 0], [-0.40, 0.86, 0], [-0.44, 0.70, 0],
    // Right arm
    [0.20, 1.34, 0], [0.32, 1.14, 0], [0.40, 0.86, 0], [0.44, 0.70, 0],
    // Left leg
    [-0.08, 0.82, 0], [-0.08, 0.46, 0], [-0.08, 0.12, 0], [-0.08, 0.03, 0.03],
    // Right leg
    [0.08, 0.82, 0], [0.08, 0.46, 0], [0.08, 0.12, 0], [0.08, 0.03, 0.03],
  ], []);

  // Limb paths for smooth capsule-like limbs
  const limbGeometries = useMemo(() => {
    const limbs: { path: [number, number, number][]; rStart: number; rEnd: number }[] = [
      // Left upper arm
      { path: [[-0.20, 1.34, 0], [-0.24, 1.28, 0], [-0.28, 1.20, 0], [-0.32, 1.14, 0]], rStart: 0.04, rEnd: 0.035 },
      // Left forearm
      { path: [[-0.32, 1.14, 0], [-0.36, 1.04, 0], [-0.38, 0.94, 0], [-0.40, 0.86, 0]], rStart: 0.035, rEnd: 0.028 },
      // Left hand
      { path: [[-0.40, 0.86, 0], [-0.42, 0.78, 0], [-0.44, 0.70, 0]], rStart: 0.025, rEnd: 0.015 },
      // Right upper arm
      { path: [[0.20, 1.34, 0], [0.24, 1.28, 0], [0.28, 1.20, 0], [0.32, 1.14, 0]], rStart: 0.04, rEnd: 0.035 },
      // Right forearm
      { path: [[0.32, 1.14, 0], [0.36, 1.04, 0], [0.38, 0.94, 0], [0.40, 0.86, 0]], rStart: 0.035, rEnd: 0.028 },
      // Right hand
      { path: [[0.40, 0.86, 0], [0.42, 0.78, 0], [0.44, 0.70, 0]], rStart: 0.025, rEnd: 0.015 },
      // Left upper leg
      { path: [[-0.08, 0.82, 0], [-0.08, 0.72, 0], [-0.08, 0.58, 0], [-0.08, 0.46, 0]], rStart: 0.06, rEnd: 0.05 },
      // Left lower leg
      { path: [[-0.08, 0.46, 0], [-0.08, 0.36, 0], [-0.08, 0.22, 0], [-0.08, 0.12, 0]], rStart: 0.045, rEnd: 0.035 },
      // Left foot
      { path: [[-0.08, 0.12, 0], [-0.08, 0.06, 0.01], [-0.08, 0.03, 0.04], [-0.08, 0.02, 0.08]], rStart: 0.035, rEnd: 0.025 },
      // Right upper leg
      { path: [[0.08, 0.82, 0], [0.08, 0.72, 0], [0.08, 0.58, 0], [0.08, 0.46, 0]], rStart: 0.06, rEnd: 0.05 },
      // Right lower leg
      { path: [[0.08, 0.46, 0], [0.08, 0.36, 0], [0.08, 0.22, 0], [0.08, 0.12, 0]], rStart: 0.045, rEnd: 0.035 },
      // Right foot
      { path: [[0.08, 0.12, 0], [0.08, 0.06, 0.01], [0.08, 0.03, 0.04], [0.08, 0.02, 0.08]], rStart: 0.035, rEnd: 0.025 },
    ];
    return limbs.map(({ path, rStart, rEnd }) => {
      const pts = path.map(p => new THREE.Vector3(p[0], p[1], p[2]));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
      return new THREE.TubeGeometry(curve, 12, (rStart + rEnd) / 2, 8, false);
    });
  }, []);

  const skinColor = '#f5d6c3';
  const boneColor = '#88ccff';

  return (
    <group>
      {/* === SKIN MESHES === */}
      {visible && (
        <>
          {/* Torso */}
          <mesh geometry={torsoGeometry}>
            <meshStandardMaterial
              color={skinColor}
              opacity={opacity}
              transparent={isTransparent}
              side={THREE.DoubleSide}
              depthWrite={!isTransparent}
            />
          </mesh>

          {/* Head */}
          <mesh geometry={headGeometry} position={[0, 1.55, 0]}>
            <meshStandardMaterial
              color={skinColor}
              opacity={opacity}
              transparent={isTransparent}
              side={THREE.DoubleSide}
              depthWrite={!isTransparent}
            />
          </mesh>

          {/* Limbs */}
          {limbGeometries.map((geo, i) => (
            <mesh key={`limb-${i}`} geometry={geo}>
              <meshStandardMaterial
                color={skinColor}
                opacity={opacity}
                transparent={isTransparent}
                side={THREE.DoubleSide}
                depthWrite={!isTransparent}
              />
            </mesh>
          ))}
        </>
      )}

      {/* === SKELETON === */}
      {wireframeVisible && (
        <>
          {/* Bone lines */}
          {skeletonLines.map((linePoints, idx) => (
            <line key={`bone-${idx}`}>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[new Float32Array(linePoints.flat()), 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial color={boneColor} opacity={0.8} transparent />
            </line>
          ))}

          {/* Joint spheres */}
          {joints.map((pos, i) => (
            <mesh key={`joint-${i}`} position={pos}>
              <sphereGeometry args={[0.012, 8, 8]} />
              <meshBasicMaterial color={boneColor} />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}
