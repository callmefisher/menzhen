import { Switch } from 'antd';
import { useAccessibility, type AccessibilityMode } from '../store/accessibility';

const modeLabels: Record<AccessibilityMode, string> = {
  normal: '标准',
  large: '大',
  xlarge: '超大',
};

export default function AccessibilitySettingsPanel() {
  const {
    mode,
    highContrast,
    looseSpacing,
    focusEnhanced,
    setMode,
    setHighContrast,
    setLooseSpacing,
    setFocusEnhanced,
  } = useAccessibility();

  return (
    <div style={{ width: 220, padding: '4px 0' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>字号大小</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['normal', 'large', 'xlarge'] as AccessibilityMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: '6px 0',
                border: mode === m ? '2px solid #52C41A' : '1px solid #d9d9d9',
                borderRadius: 6,
                background: mode === m ? '#f6ffed' : '#fff',
                cursor: 'pointer',
                fontWeight: mode === m ? 600 : 400,
                fontSize: 13,
                color: mode === m ? '#52C41A' : '#333',
              }}
            >
              {modeLabels[m]}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 13 }}>高对比度</span>
        <Switch size="small" checked={highContrast} onChange={setHighContrast} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 13 }}>加大间距</span>
        <Switch size="small" checked={looseSpacing} onChange={setLooseSpacing} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13 }}>焦点增强</span>
        <Switch size="small" checked={focusEnhanced} onChange={setFocusEnhanced} />
      </div>
    </div>
  );
}

export { modeLabels };
