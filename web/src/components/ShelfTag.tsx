import type { CSSProperties } from 'react';

const shelfTagStyle: CSSProperties = {
  display: 'inline-block',
  borderRadius: 3,
  padding: '0 4px',
  fontSize: 11,
  marginRight: 4,
  fontFamily: 'monospace',
  verticalAlign: 'middle',
};

export default function ShelfTag({ shelfNo }: { shelfNo?: string }) {
  if (shelfNo) {
    return <span style={{ ...shelfTagStyle, background: '#e6f4ff', color: '#1677ff', border: '1px solid #91caff', fontWeight: 'bold' }}>{shelfNo}</span>;
  }
  return <span style={{ ...shelfTagStyle, background: '#f5f5f5', color: '#bbb', border: '1px solid #d9d9d9' }}>--</span>;
}
