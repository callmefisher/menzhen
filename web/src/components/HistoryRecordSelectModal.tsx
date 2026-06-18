import { useState, useEffect, useCallback } from 'react';
import { Modal, Checkbox, Button, Spin, Empty, Space, Tag, Tooltip } from 'antd';
import { LeftOutlined, RightOutlined, ClearOutlined } from '@ant-design/icons';
import { listRecords } from '../api/record';
import type { RecordListItem } from '../api/record';
import useIsMobile from '../hooks/useIsMobile';

const PAGE_SIZE = 10;

// Lines that are patient-level duplicates and should be stripped from each
// historical record's diagnosis (they are preserved once in the header).
const DUPLICATE_HEADER_RE = /^(性别|年龄|出生年月|主诉|姓名)：/;

/**
 * Strip duplicate header lines (性别/年龄/出生年月/主诉/姓名) from a diagnosis
 * text block. 脉象/舌象 and clinical body are preserved since they are
 * visit-specific.
 */
export function stripDuplicateHeader(text: string): string {
  if (!text) return '';
  return text
    .split('\n')
    .filter((line) => !DUPLICATE_HEADER_RE.test(line.trim()))
    .join('\n')
    .trim();
}

/**
 * Extract the header block from the current diagnosis — everything before the
 * first `---` separator (性别/年龄/出生年月/主诉/脉象/舌象 etc.).
 */
export function extractHeader(diagnosis: string): string {
  if (!diagnosis) return '';
  const parts = diagnosis.split(/^---$/m);
  return parts[0].trim();
}

/**
 * Assemble the final diagnosis content by combining the current header with
 * selected historical records. Records with the same visit date are grouped together.
 * Each group contributes its date, followed by diagnosis and treatment for each record,
 * separated by a long dashed line.
 *
 * Records are sorted by visit date descending (newest first).
 * 
 * Format:
 *   Header (性别/年龄/出生年月/主诉/脉象/舌象)
 *   --------------------------------------------------
 *   【日期】YYYY-MM-DD
 *   【诊断】...
 *   【治疗】...
 *   【诊断】...
 *   【治疗】...
 *   --------------------------------------------------
 *   ...
 */
export function assembleHistoryContent(
  currentDiagnosis: string,
  records: RecordListItem[],
): string {
  const header = extractHeader(currentDiagnosis);
  
  if (records.length === 0) return header;

  // Group records by visit date
  const groupedByDate = records.reduce((acc, r) => {
    const date = r.visit_date || '';
    if (!acc[date]) acc[date] = [];
    acc[date].push(r);
    return acc;
  }, {} as Record<string, RecordListItem[]>);

  // Sort dates descending
  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));
  
  const separator = '\n--------------------------------------------------\n';
  const blocks = sortedDates.map((date) => {
    const dateRecords = groupedByDate[date];
    let block = `【日期】${date}`;
    dateRecords.forEach((r) => {
      const strippedDiag = stripDuplicateHeader(r.diagnosis || '');
      block += `\n【诊断】${strippedDiag}\n【治疗】${r.treatment || ''}`;
    });
    return block;
  });
  
  return header + separator + blocks.join(separator) + separator;
}

interface HistoryRecordSelectModalProps {
  open: boolean;
  patientId: number | undefined;
  patientName?: string;
  /** Current diagnosis text — used to extract the header block to preserve. */
  currentDiagnosis: string;
  onClose: () => void;
  onConfirm: (assembledContent: string) => void;
}

export default function HistoryRecordSelectModal({
  open,
  patientId,
  patientName,
  currentDiagnosis,
  onClose,
  onConfirm,
}: HistoryRecordSelectModalProps) {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<RecordListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectedRecords, setSelectedRecords] = useState<Map<number, RecordListItem>>(new Map());
  const [selectAllLoading, setSelectAllLoading] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchRecords = useCallback(async (p: number) => {
    if (!patientId) return;
    setLoading(true);
    try {
      const res = await listRecords({ patient_id: patientId, page: p, size: PAGE_SIZE });
      const body = res as unknown as { data: { list: RecordListItem[]; total: number } };
      setRecords(body.data.list || []);
      setTotal(body.data.total || 0);
    } catch {
      // handled by request interceptor
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  // Fetch records when modal opens or page changes
  useEffect(() => {
    if (open && patientId) {
      fetchRecords(page);
    }
  }, [open, patientId, page, fetchRecords]);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setPage(1);
      setSelectedIds(new Set());
      setSelectedRecords(new Map());
    }
  }, [open]);

  const toggleSelect = (record: RecordListItem) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(record.id)) next.delete(record.id);
      else next.add(record.id);
      return next;
    });
    setSelectedRecords((prev) => {
      const next = new Map(prev);
      if (next.has(record.id)) next.delete(record.id);
      else next.set(record.id, record);
      return next;
    });
  };

  const handleSelectAll = async () => {
    // If all are already selected, deselect all
    if (total > 0 && selectedIds.size >= total) {
      setSelectedIds(new Set());
      setSelectedRecords(new Map());
      return;
    }
    // Fetch all records for this patient
    if (!patientId) return;
    setSelectAllLoading(true);
    try {
      const res = await listRecords({ patient_id: patientId, page: 1, size: 9999 });
      const body = res as unknown as { data: { list: RecordListItem[]; total: number } };
      const all = body.data.list || [];
      const ids = new Set(all.map((r) => r.id));
      const map = new Map<number, RecordListItem>();
      all.forEach((r) => map.set(r.id, r));
      setSelectedIds(ids);
      setSelectedRecords(map);
    } catch {
      // handled
    } finally {
      setSelectAllLoading(false);
    }
  };

  const handleClear = () => {
    setSelectedIds(new Set());
    setSelectedRecords(new Map());
  };

  const handleConfirm = () => {
    const selected = Array.from(selectedIds)
      .map((id) => selectedRecords.get(id))
      .filter((r): r is RecordListItem => Boolean(r));
    const assembled = assembleHistoryContent(currentDiagnosis, selected);
    onConfirm(assembled);
    onClose();
  };

  const allSelected = total > 0 && selectedIds.size >= total;
  const noneSelected = selectedIds.size === 0;
  const indeterminate = !noneSelected && !allSelected;

  const truncate = (text: string, max: number) => {
    if (!text) return '';
    const oneLine = text.replace(/\n/g, ' / ');
    return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
  };

  return (
    <Modal
      title={
        <Space>
          <span>引用历史诊疗记录</span>
          {patientName && (
            <span style={{ fontSize: 13, color: '#888', fontWeight: 400 }}>
              — {patientName}（共 {total} 条）
            </span>
          )}
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={isMobile ? '95%' : 760}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#888' }}>
            确认后将<strong style={{ color: '#fa8c16' }}>替换</strong>诊断框内容（保留表头）
          </span>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={handleConfirm} disabled={noneSelected}>
              确认插入（{selectedIds.size} 条）
            </Button>
          </Space>
        </div>
      }
      destroyOnClose
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          padding: '10px 14px',
          background: '#fafafa',
          borderRadius: 8,
          border: '1px solid #f0f0f0',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Space size={16} wrap>
          <Checkbox
            checked={allSelected}
            indeterminate={indeterminate}
            onChange={handleSelectAll}
            disabled={selectAllLoading || total === 0}
          >
            全选（全部页）
          </Checkbox>
          <Button
            size="small"
            icon={<ClearOutlined />}
            onClick={handleClear}
            disabled={noneSelected}
          >
            清空选择
          </Button>
        </Space>
        <span style={{ fontSize: 13, color: '#888' }}>
          已选 <span style={{ color: '#1677ff', fontWeight: 600 }}>{selectedIds.size}</span> / {total} 条
        </span>
      </div>

      {/* Record list */}
      <Spin spinning={loading || selectAllLoading}>
        {records.length === 0 && !loading ? (
          <Empty description="该患者暂无历史诊疗记录" style={{ padding: '40px 0' }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '46vh', overflowY: 'auto' }}>
            {records.map((r) => {
              const checked = selectedIds.has(r.id);
              return (
                <div
                  key={r.id}
                  onClick={() => toggleSelect(r)}
                  style={{
                    border: `1px solid ${checked ? '#1677ff' : '#f0f0f0'}`,
                    borderRadius: 8,
                    padding: '12px 14px',
                    display: 'flex',
                    gap: 12,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    background: checked ? '#e6f4ff' : '#fff',
                  }}
                >
                  <div style={{ paddingTop: 2 }}>
                    <Checkbox checked={checked} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1677ff' }}>
                        {r.visit_date}
                      </span>
                      {r.pulse_name && (
                        <Tag style={{ fontSize: 11 }}>{r.pulse_name}</Tag>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: '#666', lineHeight: 1.7 }}>
                      {r.diagnosis && (
                        <Tooltip title={r.diagnosis} placement="topLeft">
                          <div
                            style={{
                              color: '#555',
                              background: '#fafafa',
                              padding: '6px 10px',
                              borderRadius: 6,
                              margin: '4px 0',
                              borderLeft: '3px solid #e8e8e8',
                              fontSize: 12.5,
                              maxHeight: 60,
                              overflow: 'hidden',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {truncate(r.diagnosis, 100)}
                          </div>
                        </Tooltip>
                      )}
                      {r.treatment && (
                        <div style={{ color: '#385c4d', fontSize: 12.5, marginTop: 4 }}>
                          <span style={{ color: '#999', marginRight: 4 }}>治疗：</span>
                          {truncate(r.treatment, 80)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Spin>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid #f0f0f0',
          }}
        >
          <Button
            size="small"
            icon={<LeftOutlined />}
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span style={{ fontSize: 13, color: '#888', margin: '0 8px' }}>
            第 {page} / {totalPages} 页
          </span>
          <Button
            size="small"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
            <RightOutlined />
          </Button>
        </div>
      )}
    </Modal>
  );
}
