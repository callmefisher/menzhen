import { useState, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import AcupointInfoCard from './AcupointInfoCard';
import type { AcupointData } from './data/types';

interface AcupointMarkerProps {
  data: AcupointData;
  color: string;
  isFocused: boolean;
  onClick: (acupoint: AcupointData | null) => void;
}

export default function AcupointMarker({ data, color, isFocused, onClick }: AcupointMarkerProps) {
  const [hovered, setHovered] = useState(false);
  const [showCard, setShowCard] = useState(false);
  const meshRef = useRef<THREE.Mesh>(null);

  // Smooth scale on hover (no pulse, no exaggerated scaling)
  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const targetScale = isFocused ? 1.6 : hovered ? 1.3 : 1.0;
    const current = meshRef.current.scale.x;
    const newScale = THREE.MathUtils.lerp(current, targetScale, delta * 8);
    meshRef.current.scale.setScalar(newScale);
  });

  const handleClick = () => {
    if (showCard) {
      setShowCard(false);
      onClick(null);
    } else {
      setShowCard(true);
      onClick(data);
    }
  };

  // Auto-show card when focused via search
  const cardVisible = showCard || isFocused;

  return (
    <group position={data.position}>
      {/* Acupoint dot */}
      <mesh
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onClick={handleClick}
      >
        <sphereGeometry args={[0.007, 12, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={isFocused || hovered ? color : '#000000'}
          emissiveIntensity={isFocused ? 0.5 : hovered ? 0.3 : 0}
        />
      </mesh>

      {/* Info card */}
      {cardVisible && (
        <AcupointInfoCard data={data} color={color} />
      )}
    </group>
  );
}
