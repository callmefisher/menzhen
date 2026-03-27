import { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

export type ModelType = 'female' | 'male';

const MODEL_CONFIGS: Record<ModelType, { url: string; scale: number; offsetY: number; offsetX: number; offsetZ: number }> = {
  // 女模型：保留原始真人光影
  female: { url: '/models/sport-girl.glb', scale: 1.64 / 176.5, offsetY: 0.05, offsetX: 0, offsetZ: 0 },
  // 男模型：统一材质，偏移量需与校准工具保持一致
  // 校准工具配置: offsetY: 1.4755, 无offsetX
  male:   { url: '/models/male.glb',       scale: 1.64 / 2.9342, offsetY: 1.4755, offsetX: 0, offsetZ: 0 },
};

interface HumanBodyModelProps {
  modelType?: ModelType;
  onModelLoaded?: (group: THREE.Group) => void;
}

// 统一模型材质 - 仅用于男模型
function applyUniformMaterial(group: THREE.Group) {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material) {
      child.material = new THREE.MeshStandardMaterial({
        color: 0xd4a574,
        roughness: 0.65,
        metalness: 0.02,
      });
    }
  });
}

export default function HumanBodyModel({ modelType = 'female', onModelLoaded }: HumanBodyModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const config = MODEL_CONFIGS[modelType];
  const { scene } = useGLTF(config.url);

  const clonedScene = useMemo(() => {
    const cloned = scene.clone(true);
    // 仅男模型应用统一材质，女模型保留原始真人光影
    if (modelType === 'male') {
      applyUniformMaterial(cloned);
    }
    return cloned;
  }, [scene, modelType]);

  useEffect(() => {
    if (onModelLoaded && groupRef.current) {
      onModelLoaded(groupRef.current);
    }
  }, [onModelLoaded, clonedScene]);

  return (
    <group ref={groupRef}>
      {/* Scale + position offset (向左上移动) */}
      <group 
        scale={[config.scale, config.scale, config.scale]} 
        position={[config.offsetX * config.scale, config.offsetY * config.scale, config.offsetZ * config.scale]}
      >
        <primitive object={clonedScene} />
      </group>
    </group>
  );
}

// Preload both models
useGLTF.preload(MODEL_CONFIGS.female.url);
useGLTF.preload(MODEL_CONFIGS.male.url);
