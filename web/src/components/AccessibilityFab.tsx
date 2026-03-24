import { useState } from 'react';
import { Popover } from 'antd';
import { useAccessibility } from '../store/accessibility';
import { modeLabels } from './AccessibilitySettingsPanel';
import AccessibilitySettingsPanel from './AccessibilitySettingsPanel';

export default function AccessibilityFab() {
  const { mode } = useAccessibility();
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 1050 }}>
      <Popover
        content={<AccessibilitySettingsPanel />}
        trigger="click"
        placement="topRight"
        open={open}
        onOpenChange={setOpen}
      >
        <button
          type="button"
          aria-label={`无障碍设置，当前字号：${modeLabels[mode]}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            border: 'none',
            background: mode !== 'normal' ? '#52C41A' : '#fff',
            color: mode !== 'normal' ? '#fff' : '#52C41A',
            fontSize: 18,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          Aa
        </button>
      </Popover>
    </div>
  );
}
