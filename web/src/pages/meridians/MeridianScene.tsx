import { useState, useCallback, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import HumanBodyModel from './HumanBodyModel';
import MeridianPath from './MeridianPath';
import AcupointMarker from './AcupointMarker';
import { meridianMap } from './data/meridians';
import { acupointsByMeridian } from './data/acupoints';
import { buildBVHForModel, disposeBVH } from './utils/surfaceProjection';
import type { MergedBVH } from './utils/surfaceProjection';
import type { AcupointData } from './data/types';

interface MeridianSceneProps {
  selectedMeridians: string[];
  focusedAcupoint: AcupointData | null;
  onAcupointClick: (acupoint: AcupointData | null) => void;
}

// Model center Y ≈ 0.82 (feet=0, head=1.64)
const MODEL_CENTER_Y = 0.82;

// No-op: clicking an acupoint no longer moves the camera/model
function CameraController(_props: { focusedAcupoint: AcupointData | null }) {
  return null;
}

function SceneContent({ selectedMeridians, focusedAcupoint, onAcupointClick }: MeridianSceneProps) {
  const [mergedBVH, setMergedBVH] = useState<MergedBVH | null>(null);

  // Build merged BVH when model loads
  const handleModelLoaded = useCallback((group: THREE.Group) => {
    const result = buildBVHForModel(group);
    if (result) {
      setMergedBVH(result);
    }
  }, []);

  // Cleanup BVH on unmount
  useEffect(() => {
    return () => { disposeBVH(); };
  }, []);

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
        target={[0, MODEL_CENTER_Y, 0]}
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

      {/* Human body model (opaque only) */}
      <HumanBodyModel onModelLoaded={handleModelLoaded} />

      {/* Meridian paths — BVH projects guide points onto model surface */}
      {selectedMeridians.map(id => {
        const data = meridianMap[id];
        if (!data) return null;
        return <MeridianPath key={id} data={data} mergedBVH={mergedBVH} />;
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
    </>
  );
}

export default function MeridianScene(props: MeridianSceneProps) {
  return (
    <Canvas
      camera={{
        position: [0, MODEL_CENTER_Y, 2.8],
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
