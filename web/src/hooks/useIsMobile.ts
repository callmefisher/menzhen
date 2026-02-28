import { Grid } from 'antd';

export default function useIsMobile() {
  const screens = Grid.useBreakpoint();
  // < 768px (xs is true, sm is false/undefined)
  return !screens.md;
}
