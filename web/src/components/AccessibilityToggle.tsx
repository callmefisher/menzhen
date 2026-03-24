import { Popover } from 'antd';
import { useAccessibility } from '../store/accessibility';
import { modeLabels } from './AccessibilitySettingsPanel';
import AccessibilitySettingsPanel from './AccessibilitySettingsPanel';
import useIsMobile from '../hooks/useIsMobile';

export default function AccessibilityToggle() {
  const { mode, cycleMode } = useAccessibility();
  const isMobile = useIsMobile();

  const button = (
    <button
      type="button"
      onClick={cycleMode}
      aria-label={`字号切换，当前：${modeLabels[mode]}`}
      aria-haspopup={!isMobile ? 'dialog' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 10px',
        border: '1px solid #d9d9d9',
        borderRadius: 16,
        background: mode !== 'normal' ? '#f6ffed' : '#fff',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 500,
        color: mode !== 'normal' ? '#52C41A' : '#666',
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 700 }}>Aa</span>
      <span>{modeLabels[mode]}</span>
    </button>
  );

  if (isMobile) {
    return button;
  }

  return (
    <Popover
      content={<AccessibilitySettingsPanel />}
      trigger="contextMenu"
      placement="bottomRight"
    >
      {button}
    </Popover>
  );
}
