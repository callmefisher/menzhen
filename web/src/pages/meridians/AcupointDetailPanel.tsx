import { Drawer } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { meridianMap } from './data/meridians';
import type { AcupointData } from './data/types';

interface AcupointDetailPanelProps {
  acupoint: AcupointData | null;
  onClose: () => void;
  isMobile?: boolean;
}

export default function AcupointDetailPanel({ acupoint, onClose, isMobile }: AcupointDetailPanelProps) {
  if (!acupoint && !isMobile) return null;

  const meridian = acupoint ? meridianMap[acupoint.meridianId] : undefined;
  const color = meridian?.color ?? '#666';

  const content = acupoint ? (
    <>
      {/* Header */}
      <div
        style={{
          background: color,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              background: 'rgba(255,255,255,0.25)',
              color: '#fff',
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {acupoint.code}
          </span>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>
            {acupoint.name}
          </span>
        </div>
        {!isMobile && (
          <CloseOutlined
            style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, cursor: 'pointer' }}
            onClick={onClose}
          />
        )}
      </div>

      {/* Meridian tag */}
      {meridian && (
        <div style={{ padding: '8px 14px 0', fontSize: 12, color: '#888' }}>
          所属经络：
          <span style={{ color, fontWeight: 600 }}>{meridian.name}</span>
        </div>
      )}

      {/* Detail rows */}
      <div style={{ padding: '10px 14px 14px' }}>
        <DetailRow label="定位" value={acupoint.location} />
        <DetailRow label="功效" value={acupoint.effects} />
        <DetailRow label="主治" value={acupoint.indications} />
        <DetailRow label="针法" value={acupoint.method} />
        {acupoint.contraindications && (
          <DetailRow label="禁忌" value={acupoint.contraindications} warn />
        )}
      </div>
    </>
  ) : null;

  if (isMobile) {
    return (
      <Drawer
        placement="bottom"
        open={!!acupoint}
        onClose={onClose}
        height="auto"
        styles={{
          body: { padding: 0 },
          header: { display: 'none' },
        }}
      >
        {content}
      </Drawer>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        width: 280,
        background: 'rgba(255, 255, 255, 0.96)',
        borderRadius: 10,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
        overflow: 'hidden',
        zIndex: 10,
        backdropFilter: 'blur(8px)',
      }}
    >
      {content}
    </div>
  );
}

function DetailRow({ label, value, warn }: { label: string; value?: string; warn?: boolean }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 8, fontSize: 13, lineHeight: 1.6 }}>
      <span style={{ color: warn ? '#e04040' : '#999', fontSize: 12 }}>{label}：</span>
      <span style={{ color: warn ? '#e04040' : '#333' }}>{value}</span>
    </div>
  );
}
