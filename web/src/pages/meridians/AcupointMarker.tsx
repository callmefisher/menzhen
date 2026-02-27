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

  // Animate focused/hovered state
  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const targetScale = isFocused ? 2.5 : hovered ? 1.8 : 1.0;
    const current = meshRef.current.scale.x;
    const newScale = THREE.MathUtils.lerp(current, targetScale, delta * 8);
    meshRef.current.scale.setScalar(newScale);

    // Pulse effect for focused acupoint
    if (isFocused) {
      const pulse = 1 + Math.sin(Date.now() * 0.005) * 0.3;
      meshRef.current.scale.setScalar(newScale * pulse);
    }
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
      {/* Acupoint sphere */}
      <mesh
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onClick={handleClick}
      >
        <sphereGeometry args={[0.008, 12, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={isFocused || hovered ? color : '#000000'}
          emissiveIntensity={isFocused ? 0.8 : hovered ? 0.4 : 0}
        />
      </mesh>

      {/* Glow ring for focused */}
      {isFocused && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.015, 0.02, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Info card */}
      {cardVisible && (
        <AcupointInfoCard data={data} color={color} />
      )}
    </group>
  );
}
