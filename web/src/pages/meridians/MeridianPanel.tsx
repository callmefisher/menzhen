import { useState, useMemo, useCallback } from 'react';
import { Input, Radio, Checkbox, Divider, AutoComplete, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { regularMeridians, extraordinaryMeridians } from './data/meridians';
import { acupoints } from './data/acupoints';
import type { AcupointData } from './data/types';

interface MeridianPanelProps {
  transparency: 'full' | 'semi' | 'opaque';
  onTransparencyChange: (v: 'full' | 'semi' | 'opaque') => void;
  selectedMeridians: string[];
  onMeridianToggle: (id: string) => void;
  onAcupointSearch: (acupoint: AcupointData | null) => void;
}

export default function MeridianPanel({
  transparency,
  onTransparencyChange,
  selectedMeridians,
  onMeridianToggle,
  onAcupointSearch,
}: MeridianPanelProps) {
  const [searchValue, setSearchValue] = useState('');

  // Fuzzy search acupoints
  const searchOptions = useMemo(() => {
    if (!searchValue.trim()) return [];
    const keyword = searchValue.trim().toLowerCase();
    return acupoints
      .filter(
        a =>
          a.name.toLowerCase().includes(keyword) ||
          a.code.toLowerCase().includes(keyword),
      )
      .slice(0, 20)
      .map(a => ({
        value: a.code,
        label: (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              <strong>{a.name}</strong>{' '}
              <span style={{ color: '#999', fontSize: 12 }}>{a.code}</span>
            </span>
            <Tag color="blue" style={{ fontSize: 11 }}>
              {regularMeridians.find(m => m.id === a.meridianId)?.name ||
                extraordinaryMeridians.find(m => m.id === a.meridianId)?.name ||
                a.meridianId}
            </Tag>
          </div>
        ),
        acupoint: a,
      }));
  }, [searchValue]);

  const handleSelect = useCallback(
    (_: string, option: { acupoint: AcupointData }) => {
      onAcupointSearch(option.acupoint);
      setSearchValue(option.acupoint.name);
    },
    [onAcupointSearch],
  );

  const handleClear = useCallback(() => {
    setSearchValue('');
    onAcupointSearch(null);
  }, [onAcupointSearch]);

  return (
    <div>
      {/* Acupoint search */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#333' }}>
          穴位搜索
        </div>
        <AutoComplete
          style={{ width: '100%' }}
          options={searchOptions}
          onSelect={handleSelect}
          onSearch={setSearchValue}
          value={searchValue}
          allowClear
          onClear={handleClear}
        >
          <Input
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            placeholder="输入穴位名或编码"
            size="small"
          />
        </AutoComplete>
      </div>

      <Divider style={{ margin: '12px 0' }} />

      {/* Transparency control */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#333' }}>
          透明度
        </div>
        <Radio.Group
          value={transparency}
          onChange={e => onTransparencyChange(e.target.value)}
          size="small"
          style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          <Radio value="full">全透明（骨骼）</Radio>
          <Radio value="semi">半透明</Radio>
          <Radio value="opaque">不透明</Radio>
        </Radio.Group>
      </div>

      <Divider style={{ margin: '12px 0' }} />

      {/* Regular meridians */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#333' }}>
          十二经络
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {regularMeridians.map(m => (
            <Checkbox
              key={m.id}
              checked={selectedMeridians.includes(m.id)}
              onChange={() => onMeridianToggle(m.id)}
              style={{ marginInlineStart: 0 }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: m.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13 }}>{m.name}</span>
              </span>
            </Checkbox>
          ))}
        </div>
      </div>

      <Divider style={{ margin: '12px 0' }} />

      {/* Extraordinary meridians */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#333' }}>
          奇经八脉
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {extraordinaryMeridians.map(m => (
            <Checkbox
              key={m.id}
              checked={selectedMeridians.includes(m.id)}
              onChange={() => onMeridianToggle(m.id)}
              style={{ marginInlineStart: 0 }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: m.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13 }}>{m.name}</span>
              </span>
            </Checkbox>
          ))}
        </div>
      </div>
    </div>
  );
}
