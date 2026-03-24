import { Button } from 'antd';
import { ColumnWidthOutlined } from '@ant-design/icons';

interface HiddenColumnsHintProps {
  titles: string[];
  onRestoreAll: () => void;
}

/** Shows a hint below the table listing hidden columns with a restore button. */
export default function HiddenColumnsHint({ titles, onRestoreAll }: HiddenColumnsHintProps) {
  if (titles.length === 0) return null;
  return (
    <div style={{ padding: '8px 0', fontSize: 13, color: '#8B7355' }}>
      <ColumnWidthOutlined style={{ marginRight: 6 }} />
      已隐藏列：{titles.join(' · ')}
      <Button type="link" size="small" onClick={onRestoreAll} style={{ marginLeft: 8, padding: 0 }}>
        展开更多列
      </Button>
    </div>
  );
}
