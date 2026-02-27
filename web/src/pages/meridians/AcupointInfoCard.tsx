import { Html } from '@react-three/drei';
import type { AcupointData } from './data/types';

interface AcupointInfoCardProps {
  data: AcupointData;
  color: string;
}

export default function AcupointInfoCard({ data, color }: AcupointInfoCardProps) {
  return (
    <Html
      position={[0, 0.03, 0]}
      center
      style={{ pointerEvents: 'none', transform: 'translate(-50%, -100%)' }}
      zIndexRange={[10, 0]}
    >
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.92)',
          borderRadius: 6,
          padding: '3px 8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          borderLeft: `3px solid ${color}`,
          whiteSpace: 'nowrap',
          fontSize: 12,
          color: '#333',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span
          style={{
            background: color,
            color: '#fff',
            padding: '0 4px',
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 600,
            lineHeight: '16px',
          }}
        >
          {data.code}
        </span>
        <span style={{ fontWeight: 600, fontSize: 12 }}>{data.name}</span>
      </div>
    </Html>
  );
}
