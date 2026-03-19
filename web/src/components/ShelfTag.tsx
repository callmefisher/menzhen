import type { CSSProperties } from 'react';

const shelfTagStyle: CSSProperties = {
  display: 'inline-block',
  borderRadius: 3,
  padding: '1px 4px',
  fontSize: 12,
  fontFamily: 'monospace',
  minWidth: 36,
  textAlign: 'center',
};

export default function ShelfTag({ shelfNo, style }: { shelfNo?: string; style?: CSSProperties }) {
  if (shelfNo) {
    return <span style={{ ...shelfTagStyle, background: '#f6ffed', color: '#389e0d', border: '1px solid #b7eb8f', fontWeight: 'bold', ...style }}>{shelfNo}</span>;
  }
  return <span style={{ ...shelfTagStyle, background: '#f5f5f5', color: '#ccc', border: '1px solid #e0e0e0', ...style }}>--</span>;
}
