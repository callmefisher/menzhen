import { useEffect, useState } from 'react';
import { Tag } from 'antd';

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

export default function DiagnosisPreview({ diagnosis }: DiagnosisPreviewProps) {
  const [renderedContent, setRenderedContent] = useState<JSX.Element[]>([]);

  useEffect(() => {
    if (!diagnosis) {
      setRenderedContent([]);
      return;
    }

    const lines = diagnosis.split('\n');
    const elements: JSX.Element[] = [];
    let isInTreatment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Header lines (性别/年龄/出生年月/主诉/脉象/舌象)
      if (/^(性别|年龄|出生年月|主诉|脉象|舌象)：/.test(line)) {
        elements.push(
          <div key={i} style={{ color: COLORS.header, fontWeight: 500 }}>
            {line}
          </div>
        );
        continue;
      }

      // Long separator
      if (line.startsWith('--------------------------------------------------')) {
        elements.push(
          <div key={i} style={{ color: COLORS.separator, textAlign: 'center', margin: '8px 0' }}>
            {line}
          </div>
        );
        isInTreatment = false;
        continue;
      }

      // Date tag (历史日期)
      if (line.startsWith('【历史日期】')) {
        elements.push(
          <div key={i}>
            <span style={{ color: COLORS.date, fontWeight: 600 }}>{line}</span>
          </div>
        );
        continue;
      }

      // Diagnosis tag
      if (line.startsWith('【诊断】')) {
        elements.push(
          <div key={i}>
            <span style={{ color: COLORS.label, fontWeight: 500 }}>{line}</span>
          </div>
        );
        isInTreatment = false;
        continue;
      }

      // Treatment tag
      if (line.startsWith('【治疗】')) {
        elements.push(
          <div key={i}>
            <span style={{ color: COLORS.treatment, fontWeight: 500 }}>{line}</span>
          </div>
        );
        isInTreatment = true;
        continue;
      }

      // Treatment content (following 【治疗】 tag)
      if (isInTreatment) {
        elements.push(
          <div key={i} style={{ color: COLORS.treatment, paddingLeft: 12 }}>
            {line}
          </div>
        );
        continue;
      }

      // Normal content
      elements.push(<div key={i}>{line}</div>);
    }

    setRenderedContent(elements);
  }, [diagnosis]);

  if (renderedContent.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: 16,
        background: '#1e1e1e',
        borderRadius: 8,
        maxHeight: 300,
        overflowY: 'auto',
        fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: '1px solid #333',
        }}
      >
        <Tag color="orange">预览</Tag>
        <span style={{ color: '#888', fontSize: 12 }}>带颜色区分的诊断内容预览</span>
      </div>
      <div style={{ color: '#d4d4d4' }}>{renderedContent}</div>
    </div>
  );
}
