import { Html } from '@react-three/drei';
import type { AcupointData } from './data/types';

interface AcupointInfoCardProps {
  data: AcupointData;
  color: string;
}

export default function AcupointInfoCard({ data, color }: AcupointInfoCardProps) {
  return (
    <Html
      position={[0, 0.04, 0]}
      center
      distanceFactor={0.8}
      style={{ pointerEvents: 'none' }}
    >
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.95)',
          borderRadius: 8,
          padding: '10px 14px',
          minWidth: 180,
          maxWidth: 260,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          borderLeft: `3px solid ${color}`,
          fontSize: 12,
          lineHeight: 1.6,
          color: '#333',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span
            style={{
              background: color,
              color: '#fff',
              padding: '1px 6px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {data.code}
          </span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{data.name}</span>
        </div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: '#888', fontSize: 11 }}>功效：</span>
          <span>{data.effects}</span>
        </div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: '#888', fontSize: 11 }}>主治：</span>
          <span>{data.indications}</span>
        </div>
        <div>
          <span style={{ color: '#888', fontSize: 11 }}>针法：</span>
          <span>{data.method}</span>
        </div>
        {/* Arrow pointing down */}
        <div
          style={{
            position: 'absolute',
            bottom: -6,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '6px solid rgba(255,255,255,0.95)',
          }}
        />
      </div>
    </Html>
  );
}
