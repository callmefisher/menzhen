import { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

export type ModelType = 'female' | 'male';

const MODEL_CONFIGS: Record<ModelType, { url: string; scale: number; offsetY: number }> = {
  female: { url: '/models/sport-girl.glb', scale: 1.64 / 176.5, offsetY: 0 },
  male:   { url: '/models/male.glb',       scale: 1.64 / 2.9342, offsetY: 1.4755 },
  // male model: raw height ~2.93, feet at Y=-1.4755, shift up so feet at Y=0
};

interface HumanBodyModelProps {
  modelType?: ModelType;
  onModelLoaded?: (group: THREE.Group) => void;
}

export default function HumanBodyModel({ modelType = 'female', onModelLoaded }: HumanBodyModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const config = MODEL_CONFIGS[modelType];
  const { scene } = useGLTF(config.url);

  const clonedScene = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    if (onModelLoaded && groupRef.current) {
      onModelLoaded(groupRef.current);
    }
  }, [onModelLoaded, clonedScene]);

  return (
    <group ref={groupRef}>
      {/* Scale + optional Y offset — GLB handles Z-up → Y-up via internal rotation */}
      <group scale={[config.scale, config.scale, config.scale]} position={[0, config.offsetY * config.scale, 0]}>
        <primitive object={clonedScene} />
      </group>
    </group>
  );
}

// Preload both models
useGLTF.preload(MODEL_CONFIGS.female.url);
useGLTF.preload(MODEL_CONFIGS.male.url);
