import { useEffect, useRef, useState } from 'react';
import { Button } from 'antd';

interface CallOverlayProps {
  visible: boolean;
  seq: number;
  name: string;
  room: string;
  doctor: string;
  onClose: () => void;
  duration?: number; // ms, default 15000
}

export default function CallOverlay({
  visible,
  seq,
  name,
  room,
  doctor,
  onClose,
  duration = 15000,
}: CallOverlayProps) {
  const [progress, setProgress] = useState(100);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (!visible) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    startRef.current = Date.now();
    setProgress(100);
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        onClose();
      }
    }, 50);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [visible, duration, onClose]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      background: 'rgba(255,255,255,0.97)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      borderRadius: 10, overflow: 'hidden',
    }}>
      {/* Shimmer top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: 'linear-gradient(90deg, #52c41a, #faad14, #1677ff, #52c41a)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 2s linear infinite',
      }} />

      <div style={{ fontSize: 14, color: '#999', marginBottom: 8 }}>
        请到{room || '诊室'}就诊
      </div>

      {/* Large seq number */}
      <div style={{
        fontSize: 64, fontWeight: 900, lineHeight: 1,
        background: 'linear-gradient(135deg, #52c41a, #1677ff)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        marginBottom: 4,
      }}>
        {String(seq).padStart(2, '0')}
      </div>

      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 2 }}>{name}</div>
      <div style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>{doctor} - {room || '诊室'}</div>

      <Button type="primary" onClick={onClose} style={{ minWidth: 100 }}>
        确定
      </Button>

      {/* Progress bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 4,
        background: '#f0f0f0',
      }}>
        <div style={{
          height: '100%', width: `${progress}%`,
          background: 'linear-gradient(90deg, #52c41a, #1677ff)',
          transition: 'width 0.05s linear',
        }} />
      </div>

      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
