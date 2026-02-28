import { useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import HumanBodyModel from './HumanBodyModel';
import MeridianPath from './MeridianPath';
import AcupointMarker from './AcupointMarker';
import { meridianMap } from './data/meridians';
import { acupointsByMeridian } from './data/acupoints';
import { buildBVHForModel, disposeBVH } from './utils/surfaceProjection';
import type { AcupointData } from './data/types';

interface MeridianSceneProps {
  transparency: 'full' | 'semi' | 'opaque';
  selectedMeridians: string[];
  focusedAcupoint: AcupointData | null;
  onAcupointClick: (acupoint: AcupointData | null) => void;
}

// Model Y-offset: shift downward so full body is visible when zoomed
const MODEL_Y_OFFSET = -0.75;

function CameraController({ focusedAcupoint }: { focusedAcupoint: AcupointData | null }) {
  const { camera } = useThree();
  const targetRef = useRef(new THREE.Vector3(0, 0.07, 0));

  useEffect(() => {
    if (focusedAcupoint) {
      const [x, y, z] = focusedAcupoint.position;
      const target = new THREE.Vector3(x, y + MODEL_Y_OFFSET, z);
      targetRef.current.copy(target);

      const dir = new THREE.Vector3().subVectors(camera.position, target).normalize();
      const newPos = target.clone().add(dir.multiplyScalar(0.8));
      camera.position.lerp(newPos, 0.5);
      camera.lookAt(target);
    }
  }, [focusedAcupoint, camera]);

  return null;
}

function SceneContent({ transparency, selectedMeridians, focusedAcupoint, onAcupointClick }: MeridianSceneProps) {
  const [skinMesh, setSkinMesh] = useState<THREE.Mesh | null>(null);

  // Build BVH when model loads
  const handleModelLoaded = useCallback((group: THREE.Group) => {
    const mesh = buildBVHForModel(group);
    if (mesh) {
      setSkinMesh(mesh);
    }
  }, []);

  // Cleanup BVH on unmount
  useEffect(() => {
    return () => {
      if (skinMesh) disposeBVH(skinMesh);
    };
  }, [skinMesh]);

  // Collect all visible acupoints from selected meridians
  const visibleAcupoints: AcupointData[] = [];
  for (const mId of selectedMeridians) {
    const points = acupointsByMeridian[mId];
    if (points) {
      visibleAcupoints.push(...points);
    }
  }

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />
      <directionalLight position={[-5, 3, -5]} intensity={0.3} />

      {/* Camera controls — centered on model torso, good rotation range */}
      <OrbitControls
        target={[0, 0.07, 0]}
        minDistance={0.3}
        maxDistance={5}
        enablePan
        enableDamping
        dampingFactor={0.1}
        rotateSpeed={0.8}
        minPolarAngle={0.1}
        maxPolarAngle={Math.PI - 0.1}
      />

      {/* Camera focus controller */}
      <CameraController focusedAcupoint={focusedAcupoint} />

      {/* Offset group: shift model down so it's centered in view */}
      <group position={[0, MODEL_Y_OFFSET, 0]}>
        {/* Human body model */}
        <HumanBodyModel transparency={transparency} onModelLoaded={handleModelLoaded} />

        {/* Meridian paths — with BVH surface projection */}
        {selectedMeridians.map(id => {
          const data = meridianMap[id];
          if (!data) return null;
          return <MeridianPath key={id} data={data} skinMesh={skinMesh} />;
        })}

        {/* Acupoint markers */}
        {visibleAcupoints.map(a => (
          <AcupointMarker
            key={a.code}
            data={a}
            color={meridianMap[a.meridianId]?.color ?? '#ffffff'}
            isFocused={focusedAcupoint?.code === a.code}
            onClick={onAcupointClick}
          />
        ))}
      </group>
    </>
  );
}

export default function MeridianScene(props: MeridianSceneProps) {
  return (
    <Canvas
      camera={{
        position: [0, 0.2, 2.5],
        fov: 45,
        near: 0.01,
        far: 100,
      }}
      style={{ background: '#1a1a2e' }}
    >
      <SceneContent {...props} />
    </Canvas>
  );
}
