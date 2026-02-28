import { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

interface HumanBodyModelProps {
  transparency: 'full' | 'semi' | 'opaque';
  onModelLoaded?: (group: THREE.Group) => void;
}

// Sport girl model: Z-up, height ~0 to ~176.5 units
// Our coordinate system: Y-up, height ~0 to ~1.64 units
// Transform: rotate -90° X, scale ~0.00929
const MODEL_URL = '/models/sport-girl.glb';
const MODEL_SCALE = 1.64 / 176.5; // ~0.00929

// Key for storing original material on userData
const ORIGINAL_MAT_KEY = 'originalMaterial';

export default function HumanBodyModel({ transparency, onModelLoaded }: HumanBodyModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(MODEL_URL);

  // Clone scene once, save original materials
  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        // Save original material reference (handle arrays too)
        if (Array.isArray(child.material)) {
          child.userData[ORIGINAL_MAT_KEY] = child.material.map((m: THREE.Material) => m.clone());
        } else {
          child.userData[ORIGINAL_MAT_KEY] = child.material.clone();
        }
      }
    });
    return clone;
  }, [scene]);

  // Cache semi-transparent materials per mesh (created once)
  const semiMaterials = useMemo(() => {
    const map = new Map<string, THREE.Material | THREE.Material[]>();
    clonedScene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.userData[ORIGINAL_MAT_KEY]) {
        const orig = child.userData[ORIGINAL_MAT_KEY];
        if (Array.isArray(orig)) {
          map.set(child.uuid, orig.map((m: THREE.Material) => {
            const cloned = m.clone();
            cloned.transparent = true;
            cloned.opacity = 0.3;
            cloned.depthWrite = false;
            cloned.side = THREE.DoubleSide;
            return cloned;
          }));
        } else {
          const cloned = orig.clone();
          cloned.transparent = true;
          cloned.opacity = 0.3;
          cloned.depthWrite = false;
          cloned.side = THREE.DoubleSide;
          map.set(child.uuid, cloned);
        }
      }
    });
    return map;
  }, [clonedScene]);

  // Cache wireframe material (single instance reused)
  const wireframeMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#88ccff',
        wireframe: true,
        opacity: 0.5,
        transparent: true,
      }),
    [],
  );

  // Update materials when transparency changes
  useEffect(() => {
    clonedScene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      const original = child.userData[ORIGINAL_MAT_KEY];
      if (!original) return;

      child.visible = true;

      switch (transparency) {
        case 'opaque':
          // Restore original material with textures intact
          child.material = original;
          break;
        case 'semi':
          // Use pre-cloned semi-transparent version
          child.material = semiMaterials.get(child.uuid) || original;
          break;
        case 'full':
          // Wireframe mode
          child.material = wireframeMaterial;
          break;
      }
    });
  }, [clonedScene, transparency, semiMaterials, wireframeMaterial]);

  // Notify parent when model is loaded (for BVH / surface projection)
  useEffect(() => {
    if (onModelLoaded && groupRef.current) {
      onModelLoaded(groupRef.current);
    }
  }, [onModelLoaded, clonedScene]);

  return (
    <group ref={groupRef}>
      {/* Rotate -90° X (Z-up → Y-up), then uniform scale */}
      <group rotation={[-Math.PI / 2, 0, 0]} scale={[MODEL_SCALE, MODEL_SCALE, MODEL_SCALE]}>
        <primitive object={clonedScene} />
      </group>
    </group>
  );
}

// Preload model
useGLTF.preload(MODEL_URL);
