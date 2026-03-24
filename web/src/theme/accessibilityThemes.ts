import type { ThemeConfig } from 'antd';

/**
 * warmTheme 的 token 基础值（与 App.tsx 中保持一致）
 * accessibilityThemes 在此基础上仅覆盖字号/间距相关 token
 */
const baseTokens = {
  colorPrimary: '#52C41A',
  colorBgLayout: '#FAFAF5',
  colorBgContainer: '#FFFEF9',
  borderRadius: 12,
  colorLink: '#52C41A',
  colorLinkHover: '#73D13D',
  fontFamily: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
};

const baseComponents: ThemeConfig['components'] = {
  Table: { rowHoverBg: '#FFFEF0' },
  Card: { colorBgContainer: '#FFFEF9' },
  Button: {
    colorPrimary: '#52C41A',
    colorPrimaryHover: '#73D13D',
    colorPrimaryActive: '#389E0D',
    borderRadius: 8,
  },
  Input: { borderRadius: 8 },
  Select: { borderRadius: 8 },
  Tag: { borderRadiusSM: 10 },
  Pagination: { colorPrimary: '#52C41A' },
};

export const largeTheme: ThemeConfig = {
  token: {
    ...baseTokens,
    fontSize: 18,
    lineHeight: 1.8,
  },
  components: {
    ...baseComponents,
    Table: {
      ...baseComponents!.Table,
      cellPaddingBlock: 16,
      cellPaddingInline: 16,
    },
    Modal: {
      ...(baseComponents!.Modal || {}),
    },
  },
};

export const xlargeTheme: ThemeConfig = {
  token: {
    ...baseTokens,
    fontSize: 22,
    lineHeight: 1.8,
  },
  components: {
    ...baseComponents,
    Table: {
      ...baseComponents!.Table,
      cellPaddingBlock: 20,
      cellPaddingInline: 20,
    },
    Modal: {
      ...(baseComponents!.Modal || {}),
    },
  },
};

/** 高对比度 token 覆盖 */
export const highContrastTokenOverrides: ThemeConfig['token'] = {
  colorText: '#000000',
  colorBgBase: '#FFFFFF',
  colorBorder: '#333333',
  colorPrimary: '#2D8A00',
  colorTextSecondary: '#555555',
};
