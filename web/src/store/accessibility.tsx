import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';

export type AccessibilityMode = 'normal' | 'large' | 'xlarge';

export interface AccessibilitySettings {
  version: number;
  mode: AccessibilityMode;
  highContrast: boolean;
  looseSpacing: boolean;
  focusEnhanced: boolean;
}

interface AccessibilityContextValue extends AccessibilitySettings {
  setMode: (mode: AccessibilityMode) => void;
  cycleMode: () => void;
  setHighContrast: (on: boolean) => void;
  setLooseSpacing: (on: boolean) => void;
  setFocusEnhanced: (on: boolean) => void;
}

const STORAGE_KEY = 'accessibility-settings';
const CURRENT_VERSION = 1;

const defaultSettings: AccessibilitySettings = {
  version: CURRENT_VERSION,
  mode: 'normal',
  highContrast: false,
  looseSpacing: false,
  focusEnhanced: false,
};

function loadSettings(): AccessibilitySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);
    if (parsed.version !== CURRENT_VERSION) return defaultSettings;
    return {
      version: CURRENT_VERSION,
      mode: ['normal', 'large', 'xlarge'].includes(parsed.mode) ? parsed.mode : 'normal',
      highContrast: !!parsed.highContrast,
      looseSpacing: !!parsed.looseSpacing,
      focusEnhanced: !!parsed.focusEnhanced,
    };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(s: AccessibilitySettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

const modeClasses = ['a11y-large', 'a11y-xlarge'] as const;

function applyBodyClasses(s: AccessibilitySettings) {
  const body = document.body;
  // Mode classes
  modeClasses.forEach((cls) => body.classList.remove(cls));
  if (s.mode === 'large') body.classList.add('a11y-large');
  else if (s.mode === 'xlarge') body.classList.add('a11y-xlarge');
  // Feature classes
  body.classList.toggle('high-contrast', s.highContrast);
  body.classList.toggle('spacing-loose', s.looseSpacing);
  body.classList.toggle('focus-enhanced', s.focusEnhanced);
}

const modeCycle: AccessibilityMode[] = ['normal', 'large', 'xlarge'];

const defaultContextValue: AccessibilityContextValue = {
  ...defaultSettings,
  setMode: () => {},
  cycleMode: () => {},
  setHighContrast: () => {},
  setLooseSpacing: () => {},
  setFocusEnhanced: () => {},
};

const AccessibilityContext = createContext<AccessibilityContextValue>(defaultContextValue);

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AccessibilitySettings>(loadSettings);
  const announceRef = useRef<HTMLDivElement>(null);

  // Apply body classes on mount and whenever settings change
  useEffect(() => {
    applyBodyClasses(settings);
    saveSettings(settings);
  }, [settings]);

  // Announce mode changes for screen readers
  const announce = useCallback((text: string) => {
    if (announceRef.current) {
      announceRef.current.textContent = text;
    }
  }, []);

  const setMode = useCallback((mode: AccessibilityMode) => {
    setSettings((prev) => ({ ...prev, mode }));
    const labels: Record<AccessibilityMode, string> = {
      normal: '标准模式',
      large: '大字模式',
      xlarge: '超大字模式',
    };
    announce(`已切换到${labels[mode]}`);
  }, [announce]);

  const cycleMode = useCallback(() => {
    const labels: Record<AccessibilityMode, string> = {
      normal: '标准模式',
      large: '大字模式',
      xlarge: '超大字模式',
    };
    setSettings((prev) => {
      const idx = modeCycle.indexOf(prev.mode);
      const next = modeCycle[(idx + 1) % modeCycle.length];
      // Schedule announce after state update (avoid side effect in updater)
      queueMicrotask(() => announce(`已切换到${labels[next]}`));
      return { ...prev, mode: next };
    });
  }, [announce]);

  const setHighContrast = useCallback((on: boolean) => {
    setSettings((prev) => ({ ...prev, highContrast: on }));
    announce(on ? '已开启高对比度' : '已关闭高对比度');
  }, [announce]);

  const setLooseSpacing = useCallback((on: boolean) => {
    setSettings((prev) => ({ ...prev, looseSpacing: on }));
  }, []);

  const setFocusEnhanced = useCallback((on: boolean) => {
    setSettings((prev) => ({ ...prev, focusEnhanced: on }));
  }, []);


  return (
    <AccessibilityContext.Provider
      value={{
        ...settings,
        setMode,
        cycleMode,
        setHighContrast,
        setLooseSpacing,
        setFocusEnhanced,
      }}
    >
      {children}
      {/* Screen reader announcements */}
      <div
        ref={announceRef}
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      />
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility(): AccessibilityContextValue {
  return useContext(AccessibilityContext);
}
