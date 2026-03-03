import { useState, useCallback } from 'react';
import { Drawer, Button, Segmented } from 'antd';
import { MenuOutlined } from '@ant-design/icons';
import MeridianPanel from './MeridianPanel';
import MeridianScene from './MeridianScene';
import AcupointDetailPanel from './AcupointDetailPanel';
import MeridianDetailDrawer from './MeridianDetailDrawer';
import type { AcupointData, MeridianData } from './data/types';
import type { ModelType } from './HumanBodyModel';
import useIsMobile from '../../hooks/useIsMobile';

export default function MeridianView() {
  const [selectedMeridians, setSelectedMeridians] = useState<string[]>([]);
  const [focusedAcupoint, setFocusedAcupoint] = useState<AcupointData | null>(null);
  const [panelDrawerOpen, setPanelDrawerOpen] = useState(false);
  const [detailMeridian, setDetailMeridian] = useState<MeridianData | null>(null);
  const [modelType, setModelType] = useState<ModelType>('female');
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

  const handleMeridianInfoClick = useCallback((meridian: MeridianData) => {
    setDetailMeridian(meridian);
  }, []);

  const handleDrawerAcupointNavigate = useCallback((acupoint: AcupointData) => {
    setFocusedAcupoint(acupoint);
    if (!selectedMeridians.includes(acupoint.meridianId)) {
      setSelectedMeridians(prev => [...prev, acupoint.meridianId]);
    }
    setDetailMeridian(null);
  }, [selectedMeridians]);

  const panelContent = (
    <MeridianPanel
      selectedMeridians={selectedMeridians}
      onMeridianToggle={handleMeridianToggle}
      onAcupointSearch={handleAcupointSearch}
      onMeridianInfoClick={handleMeridianInfoClick}
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
          modelType={modelType}
        />
        <Segmented
          options={[
            { label: '女', value: 'female' },
            { label: '男', value: 'male' },
          ]}
          value={modelType}
          onChange={v => setModelType(v as ModelType)}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 10,
          }}
          size="small"
        />
        <AcupointDetailPanel acupoint={focusedAcupoint} onClose={handleCloseDetail} isMobile={isMobile} />
      </div>
      <MeridianDetailDrawer
        meridian={detailMeridian}
        open={!!detailMeridian}
        onClose={() => setDetailMeridian(null)}
        onAcupointNavigate={handleDrawerAcupointNavigate}
        isMobile={isMobile}
      />
    </div>
  );
}
