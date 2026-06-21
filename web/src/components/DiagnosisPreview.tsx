import { useEffect, useState, type ReactNode } from 'react';
import { Tag } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';

interface DiagnosisPreviewProps {
  diagnosis: string;
}

const COLORS = {
  header: '#4fc1ff',
  date: '#ffd700',
  label: '#98c379',
  treatment: '#e06c75',
  separator: '#666',
};

/** Render lines within a date group (between separators) */
function renderGroupLines(lines: string[], keyPrefix: string): ReactNode[] {
  const elements: ReactNode[] = [];
  let isInTreatment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line && i === lines.length - 1) continue; // skip trailing empty

    // Date tag (历史日期)
    if (line.startsWith('【历史日期】')) {
      elements.push(
        <div key={`${keyPrefix}-date-${i}`} style={{ marginBottom: 4 }}>
          <span style={{ color: COLORS.date, fontWeight: 600, fontSize: 14 }}>{line}</span>
        </div>
      );
      isInTreatment = false;
      continue;
    }

    // Diagnosis tag
    if (line.startsWith('【诊断】')) {
      elements.push(
        <div key={`${keyPrefix}-diag-${i}`} style={{ marginTop: 6 }}>
          <span style={{ color: COLORS.label, fontWeight: 500 }}>{line}</span>
        </div>
      );
      isInTreatment = false;
      continue;
    }

    // Treatment tag
    if (line.startsWith('【治疗】')) {
      elements.push(
        <div key={`${keyPrefix}-treat-${i}`} style={{ marginTop: 6 }}>
          <span style={{ color: COLORS.treatment, fontWeight: 500 }}>{line}</span>
        </div>
      );
      isInTreatment = true;
      continue;
    }

    // Treatment content (following 【治疗】 tag)
    if (isInTreatment) {
      elements.push(
        <div key={`${keyPrefix}-tc-${i}`} style={{ color: COLORS.treatment, paddingLeft: 12 }}>
          {line}
        </div>
      );
      continue;
    }

    // Normal content
    elements.push(<div key={`${keyPrefix}-n-${i}`}>{line}</div>);
  }

  return elements;
}

export default function DiagnosisPreview({ diagnosis }: DiagnosisPreviewProps) {
  const [renderedContent, setRenderedContent] = useState<ReactNode[]>([]);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    if (!diagnosis) {
      setRenderedContent([]);
      return;
    }

    const lines = diagnosis.split('\n');
    const elements: ReactNode[] = [];

    // Split into sections by separator lines
    // headerLines: lines before the first separator
    // groups: arrays of lines between separators
    const headerLines: string[] = [];
    const groups: string[][] = [];
    let currentGroup: string[] | null = null;

    for (const line of lines) {
      if (line.startsWith('--------------------------------------------------')) {
        // Start a new group
        currentGroup = [];
        groups.push(currentGroup);
        continue;
      }
      if (currentGroup !== null) {
        currentGroup.push(line);
      } else {
        headerLines.push(line);
      }
    }

    // Render header section
    for (let i = 0; i < headerLines.length; i++) {
      const line = headerLines[i];
      if (/^(性别|年龄|出生年月|主诉|脉象|舌象)：/.test(line)) {
        elements.push(
          <div key={`h-${i}`} style={{ color: COLORS.header, fontWeight: 500 }}>
            {line}
          </div>
        );
      } else {
        elements.push(<div key={`h-${i}`}>{line}</div>);
      }
    }

    // Render each date group as a visual card
    groups.forEach((groupLines, gi) => {
      // Skip empty groups
      const nonEmpty = groupLines.filter(l => l.trim());
      if (nonEmpty.length === 0) return;

      elements.push(
        <div
          key={`group-${gi}`}
          style={{
            marginTop: 10,
            padding: '10px 12px',
            borderLeft: '3px solid #ffd700',
            borderRadius: 4,
            background: 'rgba(255, 215, 0, 0.05)',
          }}
        >
          {renderGroupLines(groupLines, `g${gi}`)}
        </div>
      );
    });

    setRenderedContent(elements);
  }, [diagnosis]);

  if (renderedContent.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        marginTop: 12,
        background: '#1e1e1e',
        borderRadius: 8,
        fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <div
        onClick={() => setCollapsed(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {collapsed ? <RightOutlined style={{ color: '#888', fontSize: 10 }} /> : <DownOutlined style={{ color: '#888', fontSize: 10 }} />}
        <Tag color="orange">预览</Tag>
        <span style={{ color: '#888', fontSize: 12 }}>带颜色区分的诊断内容预览</span>
      </div>
      {!collapsed && (
        <div style={{ padding: '0 16px 16px', maxHeight: 300, overflowY: 'auto' }}>
          <div style={{ color: '#d4d4d4' }}>{renderedContent}</div>
        </div>
      )}
    </div>
  );
}
