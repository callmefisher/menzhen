import { useState, useCallback } from 'react';
import MeridianPanel from './MeridianPanel';
import MeridianScene from './MeridianScene';
import AcupointDetailPanel from './AcupointDetailPanel';
import type { AcupointData } from './data/types';

export default function MeridianView() {
  const [transparency, setTransparency] = useState<'full' | 'semi' | 'opaque'>('full');
  const [selectedMeridians, setSelectedMeridians] = useState<string[]>([]);
  const [focusedAcupoint, setFocusedAcupoint] = useState<AcupointData | null>(null);

  const handleMeridianToggle = useCallback((id: string) => {
    setSelectedMeridians(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    );
  }, []);

  const handleAcupointSearch = useCallback((acupoint: AcupointData | null) => {
    setFocusedAcupoint(acupoint);
    if (acupoint && !selectedMeridians.includes(acupoint.meridianId)) {
      setSelectedMeridians(prev => [...prev, acupoint.meridianId]);
    }
  }, [selectedMeridians]);

  const handleCloseDetail = useCallback(() => {
    setFocusedAcupoint(null);
  }, []);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 112px)', margin: '-24px', overflow: 'hidden' }}>
      <div
        style={{
          width: 280,
          minWidth: 280,
          borderRight: '1px solid #f0f0f0',
          padding: 16,
          overflowY: 'auto',
          background: '#fafafa',
        }}
      >
        <MeridianPanel
          transparency={transparency}
          onTransparencyChange={setTransparency}
          selectedMeridians={selectedMeridians}
          onMeridianToggle={handleMeridianToggle}
          onAcupointSearch={handleAcupointSearch}
        />
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        <MeridianScene
          transparency={transparency}
          selectedMeridians={selectedMeridians}
          focusedAcupoint={focusedAcupoint}
          onAcupointClick={setFocusedAcupoint}
        />
        <AcupointDetailPanel acupoint={focusedAcupoint} onClose={handleCloseDetail} />
      </div>
    </div>
  );
}
