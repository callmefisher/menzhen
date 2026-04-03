import { useState, useEffect, useCallback } from 'react';
import { Button, Spin, Tooltip } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { getAppointmentMatrix, type WeeklyMatrixResult } from '../api/appointment';

interface Props {
  selectedDate: Dayjs;
  onDateChange: (date: Dayjs, doctorId?: number) => void;
}

const heatColor = (count: number): { bg: string; color: string } => {
  if (count === 0) return { bg: '#f5f5f5', color: '#bbb' };
  if (count <= 3)  return { bg: '#dbeafe', color: '#1d4ed8' };
  if (count <= 6)  return { bg: '#93c5fd', color: '#1e40af' };
  if (count <= 9)  return { bg: '#3b82f6', color: '#fff' };
  return             { bg: '#1d4ed8', color: '#fff' };
};

const weekMonday = (date: Dayjs): Dayjs => {
  const dow = date.day(); // 0=Sun
  return date.subtract(dow === 0 ? 6 : dow - 1, 'day').startOf('day');
};

const DOW_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const stickyStyle: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  background: '#fff',
  zIndex: 2,
};

export default function AppointmentMatrix({ selectedDate, onDateChange }: Props) {
  const [weekStart, setWeekStart] = useState<Dayjs>(() => weekMonday(selectedDate));
  const [data, setData] = useState<WeeklyMatrixResult | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchMatrix = useCallback(async (start: Dayjs) => {
    setLoading(true);
    try {
      const res = await getAppointmentMatrix(start.format('YYYY-MM-DD'));
      const body = res as unknown as { data?: WeeklyMatrixResult };
      setData(body.data ?? null);
    } catch {
      // non-critical — matrix is a summary overlay, silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMatrix(weekStart);
  }, [weekStart, fetchMatrix]);

  // Keep weekStart in sync when selectedDate jumps to a different week
  useEffect(() => {
    const monday = weekMonday(selectedDate);
    if (!monday.isSame(weekStart, 'day')) {
      setWeekStart(monday);
    }
  // weekStart intentionally excluded: adding it would re-fire on every manual
  // week-nav click, overwriting the user's navigation with selectedDate's week.
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrevWeek = () => setWeekStart((w) => w.subtract(7, 'day'));
  const handleNextWeek = () => setWeekStart((w) => w.add(7, 'day'));

  const today = dayjs().startOf('day');
  const isThisWeek = weekStart.isSame(weekMonday(today), 'day');

  if (!data && !loading) return null;

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #f0f0f0',
      borderRadius: 8,
      marginBottom: 12,
      overflow: 'hidden',
    }}>
      {/* Nav bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid #f5f5f5',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Button size="small" icon={<LeftOutlined />} onClick={handlePrevWeek} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {weekStart.format('M月D日')}–{weekStart.add(6, 'day').format('M月D日')}
          </span>
          <Button size="small" icon={<RightOutlined />} onClick={handleNextWeek} />
          {!isThisWeek && (
            <Button size="small" onClick={() => setWeekStart(weekMonday(dayjs()))}>
              本周
            </Button>
          )}
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#999' }}>
          {[
            { bg: '#f5f5f5', label: '0' },
            { bg: '#dbeafe', label: '1-3' },
            { bg: '#93c5fd', label: '4-6' },
            { bg: '#3b82f6', label: '7-9' },
            { bg: '#1d4ed8', label: '10+' },
          ].map(({ bg, label }) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <span style={{
                width: 10, height: 10, borderRadius: 2, background: bg, display: 'inline-block',
                border: bg === '#f5f5f5' ? '1px solid #e0e0e0' : undefined,
              }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Mobile scroll hint */}
      {isMobile && (
        <div style={{ padding: '2px 12px 3px', fontSize: 10, color: '#bbb' }}>
          ← 左右滑动查看全周
        </div>
      )}

      {/* Matrix table */}
      <Spin spinning={loading} size="small">
        <div style={{ overflowX: 'auto', overflowY: 'visible', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: 480 }}>
            <thead>
              <tr>
                <th style={{
                  ...stickyStyle,
                  textAlign: 'left', padding: '6px 8px 6px 14px',
                  fontSize: 10, fontWeight: 600, color: '#999',
                  background: '#fafafa', borderBottom: '1px solid #f0f0f0',
                  borderRight: '1px solid #f0f0f0', minWidth: 64,
                }}>
                  医生
                </th>
                {(data?.days ?? []).map((day, i) => {
                  const d = dayjs(day);
                  const isToday = d.isSame(today, 'day');
                  const isSelected = d.isSame(selectedDate, 'day');
                  return (
                    <th key={day} style={{
                      padding: '6px 4px', textAlign: 'center', fontSize: 10,
                      fontWeight: isToday ? 700 : 600,
                      color: isToday ? '#1677ff' : '#666',
                      background: isSelected ? 'rgba(22,119,255,0.06)' : '#fafafa',
                      borderBottom: '1px solid #f0f0f0',
                      whiteSpace: 'nowrap',
                    }}>
                      {DOW_LABELS[i]}<br />
                      <span style={{ fontWeight: isToday ? 700 : 400, fontSize: 9 }}>
                        {d.format('M/D')}
                      </span>
                    </th>
                  );
                })}
                <th style={{
                  padding: '6px 10px', textAlign: 'center', fontSize: 10,
                  fontWeight: 700, color: '#333',
                  background: '#f5f5f5',
                  borderBottom: '1px solid #f0f0f0',
                  borderLeft: '1px solid #e8e8e8',
                  whiteSpace: 'nowrap',
                }}>
                  合计
                </th>
              </tr>
            </thead>

            <tbody>
              {(data?.doctors ?? []).map((doc) => (
                <tr key={doc.doctor_id}>
                  <td style={{
                    ...stickyStyle,
                    padding: '3px 8px 3px 14px', fontSize: 12, fontWeight: 500,
                    borderRight: '1px solid #f0f0f0',
                    borderBottom: '1px solid #fafafa',
                    whiteSpace: 'nowrap',
                  }}>
                    {doc.doctor_name}
                  </td>
                  {(data?.days ?? []).map((day) => {
                    const count = data?.counts[String(doc.doctor_id)]?.[day] ?? 0;
                    const { bg, color } = heatColor(count);
                    const d = dayjs(day);
                    const isSelected = d.isSame(selectedDate, 'day');
                    return (
                      <td key={day} style={{
                        padding: '3px 3px',
                        background: isSelected ? 'rgba(22,119,255,0.04)' : undefined,
                        borderBottom: '1px solid #fafafa',
                      }}>
                        <Tooltip title={count > 0 ? `${doc.doctor_name} ${d.format('M月D日')} ${count}人` : undefined}>
                          <div
                            onClick={() => onDateChange(d, count > 0 ? doc.doctor_id : undefined)}
                            style={{
                              display: 'flex', flexDirection: 'column',
                              alignItems: 'center', justifyContent: 'center',
                              borderRadius: 6, cursor: 'pointer',
                              background: bg, color,
                              fontWeight: 700,
                              fontSize: isMobile ? 12 : 13,
                              minHeight: isMobile ? 40 : 44,
                              minWidth: 34,
                              margin: '1px',
                              transition: 'transform 0.1s',
                              outline: isSelected ? '2px solid #1677ff' : undefined,
                              outlineOffset: isSelected ? 1 : undefined,
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.08)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = ''; }}
                          >
                            {count === 0 ? '—' : count}
                            {count > 0 && <span style={{ fontSize: 9, fontWeight: 400, opacity: 0.75, marginTop: 1 }}>人</span>}
                          </div>
                        </Tooltip>
                      </td>
                    );
                  })}
                  <td style={{
                    padding: '3px 10px', textAlign: 'center',
                    fontWeight: 700, fontSize: 13, color: '#333',
                    background: '#fafafa', borderLeft: '1px solid #e8e8e8',
                    borderBottom: '1px solid #fafafa',
                  }}>
                    {data?.row_totals[String(doc.doctor_id)] ?? 0}
                  </td>
                </tr>
              ))}
              {!loading && (data?.doctors ?? []).length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '16px', color: '#999', fontSize: 12 }}>
                    本周暂无预约
                  </td>
                </tr>
              )}
            </tbody>

            {(data?.doctors ?? []).length > 0 && (
              <tfoot>
                <tr>
                  <td style={{
                    ...stickyStyle,
                    padding: '5px 8px 5px 14px', fontSize: 11,
                    color: '#999', fontWeight: 500,
                    borderRight: '1px solid #f0f0f0',
                    borderTop: '1px solid #e8e8e8',
                    background: '#fafafa',
                  }}>
                    每日合计
                  </td>
                  {(data?.days ?? []).map((day) => {
                    const total = data?.col_totals[day] ?? 0;
                    const d = dayjs(day);
                    const isToday = d.isSame(today, 'day');
                    const isSelected = d.isSame(selectedDate, 'day');
                    return (
                      <td key={day} style={{
                        padding: '5px 3px', textAlign: 'center',
                        fontSize: 11, fontWeight: 700,
                        color: isToday ? '#1677ff' : '#555',
                        background: isSelected ? 'rgba(22,119,255,0.06)' : '#fafafa',
                        borderTop: '1px solid #e8e8e8',
                      }}>
                        {total || '—'}
                      </td>
                    );
                  })}
                  <td style={{
                    padding: '5px 10px', textAlign: 'center',
                    fontSize: 13, fontWeight: 700, color: '#333',
                    background: '#f0f0f0',
                    borderLeft: '1px solid #e8e8e8',
                    borderTop: '1px solid #e8e8e8',
                  }}>
                    {data?.grand_total ?? 0}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Spin>
    </div>
  );
}
