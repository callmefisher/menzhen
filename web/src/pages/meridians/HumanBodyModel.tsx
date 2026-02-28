import { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

interface HumanBodyModelProps {
  onModelLoaded?: (group: THREE.Group) => void;
}

// Sport girl GLB: raw vertices are Z-up (0~176.5), but the GLB's internal
// Sketchfab_model node already has Rx(-90°) converting to Y-up.
// We only need uniform scale, NO extra rotation.
const MODEL_URL = '/models/sport-girl.glb';
const MODEL_SCALE = 1.64 / 176.5; // ~0.00929

export default function HumanBodyModel({ onModelLoaded }: HumanBodyModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(MODEL_URL);

  const clonedScene = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    if (onModelLoaded && groupRef.current) {
      onModelLoaded(groupRef.current);
    }
  }, [onModelLoaded, clonedScene]);

  return (
    <group ref={groupRef}>
      {/* Scale only — GLB already handles Z-up → Y-up via internal rotation */}
      <group scale={[MODEL_SCALE, MODEL_SCALE, MODEL_SCALE]}>
        <primitive object={clonedScene} />
      </group>
    </group>
  );
}

useGLTF.preload(MODEL_URL);
