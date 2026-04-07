import { useState, useCallback, useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '../../lib/drei-lite';
import * as THREE from 'three';
import HumanBodyModel from './HumanBodyModel';
import type { ModelType } from './HumanBodyModel';
import MeridianPath from './MeridianPath';
import AcupointMarker from './AcupointMarker';
import { getMeridianMap } from './data/meridians';
import { getAcupointsByMeridian } from './data/acupoints';
import { buildBVHForModel, disposeBVH } from './utils/meridianProjection';
import type { MergedBVH } from './utils/meridianProjection';
import type { AcupointData } from './data/types';

interface MeridianSceneProps {
  selectedMeridians: string[];
  focusedAcupoint: AcupointData | null;
  onAcupointClick: (acupoint: AcupointData | null) => void;
  modelType?: ModelType;
}

// 使用与校准工具相同的相机设置
const CALIBRATOR_CAMERA_POS: [number, number, number] = [-0.6, 1.25, 0.5];
const CALIBRATOR_TARGET: [number, number, number] = [-0.35, 1.15, 0];

// No-op: clicking an acupoint no longer moves the camera/model
function CameraController(_props: { focusedAcupoint: AcupointData | null }) {
  // _props 故意不使用，组件保留用于未来扩展
  void _props;
  return null;
}

function SceneContent({ selectedMeridians, focusedAcupoint, onAcupointClick, modelType = 'female' }: MeridianSceneProps) {
  const [mergedBVH, setMergedBVH] = useState<MergedBVH | null>(null);

  // Build merged BVH when model loads
  const handleModelLoaded = useCallback((group: THREE.Group) => {
    const result = buildBVHForModel(group, modelType);
    if (result) {
      setMergedBVH(result);
    }
  }, [modelType]);

  // Cleanup BVH on unmount
  useEffect(() => {
    return () => { disposeBVH(); };
  }, []);

  // 使用当前模型类型的经络和穴位数据
  const meridianMap = getMeridianMap(modelType);
  const acupointsByMeridian = getAcupointsByMeridian(modelType);

  // Collect all visible acupoints from selected meridians
  const visibleAcupoints: AcupointData[] = useMemo(() => {
    const points: AcupointData[] = [];
    for (const mId of selectedMeridians) {
      const meridianPoints = acupointsByMeridian[mId];
      if (meridianPoints) {
        points.push(...meridianPoints);
      }
    }
    return points;
  }, [selectedMeridians, acupointsByMeridian]);

  return (
    <>
      {/* Lighting — 使用与校准工具相同的设置 */}
      <ambientLight color={0xffeedd} intensity={0.5} />
      <directionalLight position={[1.5, 2.5, 2]} intensity={1.2} />
      <directionalLight position={[-2, 1.5, -1]} intensity={0.3} color={0x6366f1} />

      {/* Camera controls — 使用与校准工具相同的设置 */}
      <OrbitControls
        target={CALIBRATOR_TARGET}
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
      <HumanBodyModel modelType={modelType} onModelLoaded={handleModelLoaded} />

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
          mergedBVH={mergedBVH}
        />
      ))}
    </>
  );
}

export default function MeridianScene(props: MeridianSceneProps) {
  const modelType = props.modelType ?? 'female';
  return (
    <Canvas
      camera={{
        position: CALIBRATOR_CAMERA_POS,
        fov: 45,
        near: 0.01,
        far: 100,
      }}
      style={{ background: '#0a0a0f' }}
    >
      <SceneContent key={modelType} {...props} />
    </Canvas>
  );
}
