import { useState, useCallback } from 'react';
import { Drawer, Button } from 'antd';
import { MenuOutlined } from '@ant-design/icons';
import MeridianPanel from './MeridianPanel';
import MeridianScene from './MeridianScene';
import AcupointDetailPanel from './AcupointDetailPanel';
import type { AcupointData } from './data/types';
import useIsMobile from '../../hooks/useIsMobile';

export default function MeridianView() {
  const [selectedMeridians, setSelectedMeridians] = useState<string[]>([]);
  const [focusedAcupoint, setFocusedAcupoint] = useState<AcupointData | null>(null);
  const [panelDrawerOpen, setPanelDrawerOpen] = useState(false);
  const isMobile = useIsMobile();

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
    if (isMobile) setPanelDrawerOpen(false);
  }, [selectedMeridians, isMobile]);

  const handleCloseDetail = useCallback(() => {
    setFocusedAcupoint(null);
  }, []);

  const panelContent = (
    <MeridianPanel
      selectedMeridians={selectedMeridians}
      onMeridianToggle={handleMeridianToggle}
      onAcupointSearch={handleAcupointSearch}
    />
  );

  return (
    <div style={{ display: 'flex', height: isMobile ? 'calc(100vh - 80px)' : 'calc(100vh - 112px)', margin: isMobile ? '-12px' : '-24px', overflow: 'hidden' }}>
      {isMobile ? (
        <>
          <Drawer
            placement="left"
            open={panelDrawerOpen}
            onClose={() => setPanelDrawerOpen(false)}
            width={280}
            styles={{ body: { padding: 16, background: '#fafafa' } }}
            title="经络选择"
          >
            {panelContent}
          </Drawer>
          <Button
            type="primary"
            icon={<MenuOutlined />}
            onClick={() => setPanelDrawerOpen(true)}
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 10,
            }}
            size="small"
          >
            经络
          </Button>
        </>
      ) : (
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
          {panelContent}
        </div>
      )}
      <div style={{ flex: 1, position: 'relative' }}>
        <MeridianScene
          selectedMeridians={selectedMeridians}
          focusedAcupoint={focusedAcupoint}
          onAcupointClick={setFocusedAcupoint}
        />
        <AcupointDetailPanel acupoint={focusedAcupoint} onClose={handleCloseDetail} isMobile={isMobile} />
      </div>
    </div>
  );
}
