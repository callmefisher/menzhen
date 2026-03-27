import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Input, Checkbox, Divider, Tag } from 'antd';
import { SearchOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { regularMeridians, extraordinaryMeridians } from './data/meridians';
import { acupoints, acupointsByMeridian } from './data/acupoints';
import type { AcupointData, MeridianData } from './data/types';
import useIsMobile from '../../hooks/useIsMobile';

function MeridianItem({
  meridian,
  checked,
  selectedAcupoint,
  onToggle,
  onAcupointClick,
  onInfoClick,
  isMobile,
}: {
  meridian: MeridianData;
  checked: boolean;
  selectedAcupoint: AcupointData | null;
  onToggle: (id: string) => void;
  onAcupointClick: (acupoint: AcupointData) => void;
  onInfoClick: (meridian: MeridianData) => void;
  isMobile: boolean;
}) {
  const points = acupointsByMeridian[meridian.id] || [];

  // 如果当前经络有选中的穴位，只显示该穴位；否则显示所有穴位
  const visiblePoints = useMemo(() => {
    if (selectedAcupoint && selectedAcupoint.meridianId === meridian.id) {
      return [selectedAcupoint];
    }
    return points;
  }, [points, selectedAcupoint, meridian.id]);

  return (
    <div>
      <Checkbox
        checked={checked}
        onChange={() => onToggle(meridian.id)}
        style={{ marginInlineStart: 0, minHeight: isMobile ? 44 : undefined, display: 'flex', alignItems: 'center' }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: meridian.color,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 13 }}>{meridian.name}</span>
          <span style={{ fontSize: 11, color: '#999' }}>({points.length})</span>
          <span
            style={{ cursor: 'pointer', color: '#999', fontSize: 12, marginLeft: 2, padding: isMobile ? '8px 4px' : undefined }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onInfoClick(meridian);
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            title="查看经络详情"
          >
            <InfoCircleOutlined />
          </span>
        </span>
      </Checkbox>
      {checked && visiblePoints.length > 0 && (
        <div
          style={{
            marginLeft: 28,
            marginTop: 2,
            marginBottom: 4,
            display: 'flex',
            flexWrap: 'wrap',
            gap: isMobile ? 2 : 4,
          }}
        >
          {visiblePoints.map(a => (
            <Tag
              key={a.code}
              color={meridian.color}
              style={{
                cursor: 'pointer',
                fontSize: isMobile ? 10 : 11,
                lineHeight: isMobile ? '22px' : '20px',
                margin: 0,
                borderRadius: 4,
                padding: isMobile ? '0 4px' : undefined,
              }}
              onClick={() => onAcupointClick(a)}
            >
              {a.name}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}

interface MeridianPanelProps {
  selectedMeridians: string[];
  onMeridianToggle: (id: string) => void;
  onAcupointSearch: (acupoint: AcupointData | null) => void;
  onMeridianInfoClick: (meridian: MeridianData) => void;
}

export default function MeridianPanel({
  selectedMeridians,
  onMeridianToggle,
  onAcupointSearch,
  onMeridianInfoClick,
}: MeridianPanelProps) {
  const [searchValue, setSearchValue] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedAcupoint, setSelectedAcupoint] = useState<AcupointData | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const searchResults = useMemo(() => {
    if (!searchValue.trim()) return [];
    const keyword = searchValue.trim().toLowerCase();
    return acupoints
      .filter(
        a =>
          a.name.toLowerCase().includes(keyword) ||
          a.code.toLowerCase().includes(keyword),
      )
      .slice(0, 20);
  }, [searchValue]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
    setDropdownOpen(true);
  }, []);

  const handleSelect = useCallback(
    (acupoint: AcupointData) => {
      setSelectedAcupoint(acupoint);
      onAcupointSearch(acupoint);
      setSearchValue(acupoint.name);
      setDropdownOpen(false);
    },
    [onAcupointSearch],
  );

  const handleClear = useCallback(() => {
    setSearchValue('');
    setSelectedAcupoint(null);
    onAcupointSearch(null);
    setDropdownOpen(false);
  }, [onAcupointSearch]);

  return (
    <div>
      {/* Acupoint search */}
      <div style={{ marginBottom: 16 }} ref={wrapperRef}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#333' }}>
          穴位搜索
        </div>
        <div style={{ position: 'relative' }}>
          <Input
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            placeholder="输入穴位名或编码"
            size="small"
            value={searchValue}
            onChange={handleInputChange}
            onFocus={() => searchResults.length > 0 && setDropdownOpen(true)}
            allowClear
            onClear={handleClear}
          />
          {dropdownOpen && searchResults.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                marginTop: 4,
                background: '#fff',
                borderRadius: 6,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                maxHeight: 280,
                overflowY: 'auto',
                zIndex: 50,
              }}
            >
              {searchResults.map(a => (
                <div
                  key={a.code}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: isMobile ? '10px 10px' : '6px 10px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    fontSize: 13,
                    minHeight: isMobile ? 44 : undefined,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => handleSelect(a)}
                >
                  <Tag color="blue" style={{ fontSize: 10, lineHeight: '18px', margin: 0, flexShrink: 0 }}>
                    {a.code}
                  </Tag>
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Divider style={{ margin: '12px 0' }} />

      {/* Regular meridians */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#333' }}>
          十二经络
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {regularMeridians.map(m => (
            <MeridianItem
              key={m.id}
              meridian={m}
              checked={selectedMeridians.includes(m.id)}
              selectedAcupoint={selectedAcupoint}
              onToggle={onMeridianToggle}
              onAcupointClick={handleSelect}
              onInfoClick={onMeridianInfoClick}
              isMobile={isMobile}
            />
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
            <MeridianItem
              key={m.id}
              meridian={m}
              checked={selectedMeridians.includes(m.id)}
              selectedAcupoint={selectedAcupoint}
              onToggle={onMeridianToggle}
              onAcupointClick={handleSelect}
              onInfoClick={onMeridianInfoClick}
              isMobile={isMobile}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
