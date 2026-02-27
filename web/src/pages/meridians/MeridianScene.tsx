import { useRef, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import HumanBodyModel from './HumanBodyModel';
import MeridianPath from './MeridianPath';
import AcupointMarker from './AcupointMarker';
import { meridianMap } from './data/meridians';
import { acupointsByMeridian } from './data/acupoints';
import type { AcupointData } from './data/types';

interface MeridianSceneProps {
  transparency: 'full' | 'semi' | 'opaque';
  selectedMeridians: string[];
  focusedAcupoint: AcupointData | null;
  onAcupointClick: (acupoint: AcupointData | null) => void;
}

function CameraController({ focusedAcupoint }: { focusedAcupoint: AcupointData | null }) {
  const { camera } = useThree();
  const targetRef = useRef(new THREE.Vector3(0, 0.85, 0));

  useEffect(() => {
    if (focusedAcupoint) {
      const [x, y, z] = focusedAcupoint.position;
      // Move camera to look at the acupoint
      const target = new THREE.Vector3(x, y, z);
      targetRef.current.copy(target);

      // Position camera closer to the acupoint
      const dir = new THREE.Vector3().subVectors(camera.position, target).normalize();
      const newPos = target.clone().add(dir.multiplyScalar(0.8));
      camera.position.lerp(newPos, 0.5);
      camera.lookAt(target);
    }
  }, [focusedAcupoint, camera]);

  return null;
}

function SceneContent({ transparency, selectedMeridians, focusedAcupoint, onAcupointClick }: MeridianSceneProps) {
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

      {/* Camera controls */}
      <OrbitControls
        target={[0, 0.85, 0]}
        minDistance={0.3}
        maxDistance={5}
        enablePan
        enableDamping
        dampingFactor={0.1}
      />

      {/* Camera focus controller */}
      <CameraController focusedAcupoint={focusedAcupoint} />

      {/* Human body model */}
      <HumanBodyModel transparency={transparency} />

      {/* Meridian paths */}
      {selectedMeridians.map(id => {
        const data = meridianMap[id];
        if (!data) return null;
        return <MeridianPath key={id} data={data} />;
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
        position: [0, 1.0, 2.0],
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
