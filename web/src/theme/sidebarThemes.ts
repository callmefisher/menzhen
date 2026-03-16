export interface SidebarTheme {
  key: string;
  label: string;
  sidebarBg: string;
  titleColor: string;
  selectedBg: string;
  hoverBg: string;
  subMenuBg: string;
  colorDot: string;
  headerBg: string;
  headerBorder: string;
  tableHeaderBg: string;
  tableHeaderColor: string;
  tableHeaderBorder: string;
  searchBarBg: string;
  searchBarBorder: string;
}

export const sidebarThemes: Record<string, SidebarTheme> = {
  mogreen: {
    key: 'mogreen',
    label: '墨绿',
    sidebarBg: '#1A2E1A',
    titleColor: '#95DE64',
    selectedBg: 'rgba(82, 196, 26, 0.2)',
    hoverBg: 'rgba(149, 222, 100, 0.15)',
    subMenuBg: 'rgba(0, 0, 0, 0.2)',
    colorDot: '#1A2E1A',
    headerBg: 'linear-gradient(90deg, rgba(26,46,26,0.06), rgba(26,46,26,0.02))',
    headerBorder: 'rgba(26,46,26,0.12)',
    tableHeaderBg: 'rgba(26,46,26,0.06)',
    tableHeaderColor: '#2d4a2d',
    tableHeaderBorder: 'rgba(26,46,26,0.1)',
    searchBarBg: 'linear-gradient(135deg, rgba(26,46,26,0.04), rgba(26,46,26,0.01))',
    searchBarBorder: 'rgba(26,46,26,0.1)',
  },
  warmgray: {
    key: 'warmgray',
    label: '暖灰蓝',
    sidebarBg: '#1F2937',
    titleColor: '#D4B896',
    selectedBg: 'rgba(212, 184, 150, 0.2)',
    hoverBg: 'rgba(212, 184, 150, 0.12)',
    subMenuBg: 'rgba(0, 0, 0, 0.15)',
    colorDot: '#1F2937',
    headerBg: 'linear-gradient(90deg, rgba(31,41,55,0.06), rgba(31,41,55,0.02))',
    headerBorder: 'rgba(31,41,55,0.12)',
    tableHeaderBg: 'rgba(31,41,55,0.06)',
    tableHeaderColor: '#374151',
    tableHeaderBorder: 'rgba(31,41,55,0.1)',
    searchBarBg: 'linear-gradient(135deg, rgba(31,41,55,0.04), rgba(31,41,55,0.01))',
    searchBarBorder: 'rgba(31,41,55,0.1)',
  },
  navy: {
    key: 'navy',
    label: '藏青',
    sidebarBg: '#0F1B2D',
    titleColor: '#7EC8E3',
    selectedBg: 'rgba(126, 200, 227, 0.2)',
    hoverBg: 'rgba(126, 200, 227, 0.12)',
    subMenuBg: 'rgba(0, 0, 0, 0.2)',
    colorDot: '#0F1B2D',
    headerBg: 'linear-gradient(90deg, rgba(15,27,45,0.06), rgba(15,27,45,0.02))',
    headerBorder: 'rgba(15,27,45,0.12)',
    tableHeaderBg: 'rgba(15,27,45,0.06)',
    tableHeaderColor: '#1a2d47',
    tableHeaderBorder: 'rgba(15,27,45,0.1)',
    searchBarBg: 'linear-gradient(135deg, rgba(15,27,45,0.04), rgba(15,27,45,0.01))',
    searchBarBorder: 'rgba(15,27,45,0.1)',
  },
};

export const defaultThemeKey = 'mogreen';
