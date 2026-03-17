import { useState, useEffect, useCallback, useRef } from 'react';
import { Form, Input, DatePicker, Select, Modal, Switch, Spin, message } from 'antd';
import { DownOutlined, RightOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { listFollowUps, createFollowUp, updateFollowUp } from '../api/followUp';
import type { FollowUpListItem, CreateFollowUpReq, UpdateFollowUpReq } from '../api/followUp';
import { useAuth } from '../store/auth';
import useIsMobile from '../hooks/useIsMobile';

const { TextArea } = Input;

interface FollowUpPanelProps {
  recordId: number;
  patientId: number;
  patientName: string;
  patientPhone?: string;
  highlightFollowUpId?: number;
}

const statusConfig: Record<string, { label: string; bg: string; color: string }> = {
  overdue: { label: '逾期', bg: '#fff2f0', color: '#ff4d4f' },
  pending: { label: '待回访', bg: '#e6f4ff', color: '#1677ff' },
  completed: { label: '已完成', bg: '#f6ffed', color: '#52c41a' },
};

const METHOD_OPTIONS = [
  { label: '电话', value: '电话' },
  { label: '微信', value: '微信' },
  { label: '到诊', value: '到诊' },
  { label: '其他', value: '其他' },
];

export default function FollowUpPanel({ recordId, patientId, patientName, patientPhone, highlightFollowUpId }: FollowUpPanelProps) {
  const isMobile = useIsMobile();
  const { hasPermission } = useAuth();

  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<FollowUpListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FollowUpListItem | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [isOtherMethod, setIsOtherMethod] = useState(false);
  const [lastSavedId, setLastSavedId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const highlightRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listFollowUps({ record_id: recordId, size: 200 });
      const body = res as any;
      const list: FollowUpListItem[] = body.data?.list || [];
      const order: Record<string, number> = { overdue: 0, pending: 1, completed: 2 };
      list.sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1));
      setItems(list);

      if (highlightFollowUpId || list.some(i => i.status !== 'completed')) {
        setExpanded(true);
      }
    } catch { /* interceptor handles */ }
    finally { setLoading(false); }
  }, [recordId, highlightFollowUpId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Clear highlight after 5s
  useEffect(() => {
    if (!lastSavedId) return;
    const timer = setTimeout(() => setLastSavedId(null), 5000);
    return () => clearTimeout(timer);
  }, [lastSavedId]);

  useEffect(() => {
    if (highlightFollowUpId && highlightRef.current && !loading && items.some(i => i.id === highlightFollowUpId)) {
      highlightRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }
  }, [highlightFollowUpId, loading, items]);

  const statusSummary = () => {
    const counts = { overdue: 0, pending: 0, completed: 0 };
    items.forEach(i => {
      if (i.status in counts) counts[i.status as keyof typeof counts]++;
    });
    return counts;
  };

  const handleComplete = async (item: FollowUpListItem) => {
    try {
      const today = dayjs().format('YYYY-MM-DD');
      await updateFollowUp(item.id, { actual_date: today });
      message.success('已标记完成');
      fetchData();
      window.dispatchEvent(new Event('followup-data-changed'));
    } catch { message.error('操作失败'); }
  };

  const handleEdit = (item: FollowUpListItem) => {
    setEditing(item);
    const isOther = !['电话', '微信', '到诊'].includes(item.method);
    setIsOtherMethod(isOther);
    form.setFieldsValue({
      planned_date: item.planned_date ? dayjs(item.planned_date) : undefined,
      actual_date: item.actual_date ? dayjs(item.actual_date) : undefined,
      method: isOther ? '其他' : item.method,
      custom_method: isOther ? item.method : undefined,
      content: item.content,
      is_recovered: item.is_recovered,
    });
    setModalOpen(true);
  };

  const handleAdd = () => {
    form.resetFields();
    setEditing(null);
    setIsOtherMethod(false);
    form.setFieldsValue({ planned_date: dayjs().add(15, 'day'), method: '电话' });
    setModalOpen(true);
  };

  const handleModalOk = async () => {
    const values = await form.validateFields();
    setConfirmLoading(true);
    try {
      const method = values.method === '其他' ? (values.custom_method || '其他') : values.method;
      if (editing) {
        const req: UpdateFollowUpReq = {
          planned_date: values.planned_date?.format('YYYY-MM-DD'),
          actual_date: values.actual_date ? values.actual_date.format('YYYY-MM-DD') : '',
          method,
          content: values.content || '',
          is_recovered: values.is_recovered ?? false,
        };
        await updateFollowUp(editing.id, req);
        message.success('更新成功');
        setLastSavedId(editing.id);
      } else {
        const req: CreateFollowUpReq = {
          patient_id: patientId,
          record_id: recordId,
          planned_date: values.planned_date.format('YYYY-MM-DD'),
          method,
          content: values.content || '',
        };
        const res = await createFollowUp(req);
        const body = res as any;
        message.success('创建成功');
        if (body.data?.id) setLastSavedId(body.data.id);
      }
      setModalOpen(false);
      fetchData();
      window.dispatchEvent(new Event('followup-data-changed'));
    } catch { message.error('操作失败'); }
    finally { setConfirmLoading(false); }
  };

  const counts = statusSummary();

  return (
    <>
      <div style={{
        background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f5 100%)',
        borderRadius: 8,
        border: '1px solid #f0f0f0',
        marginTop: 16,
      }}>
        <div
          onClick={() => setExpanded(!expanded)}
          style={{
            padding: isMobile ? '10px 12px' : '12px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <div>
            <span style={{ fontWeight: 600, fontSize: isMobile ? 13 : 14 }}>回访</span>
            {items.length === 0 && !loading && (
              <span style={{ marginLeft: 8, color: '#999', fontSize: 12 }}>· 暂无</span>
            )}
            {items.length > 0 && (
              <span style={{ marginLeft: 8 }}>
                {counts.overdue > 0 && (
                  <span style={{ background: '#ff4d4f', color: '#fff', padding: '0 6px', borderRadius: 8, fontSize: 11, marginRight: 4 }}>
                    {counts.overdue}{isMobile ? '逾' : '逾期'}
                  </span>
                )}
                {counts.pending > 0 && (
                  <span style={{ background: '#e6f4ff', color: '#1677ff', padding: '0 6px', borderRadius: 8, fontSize: 11, marginRight: 4 }}>
                    {counts.pending}{isMobile ? '待' : '待回访'}
                  </span>
                )}
                {counts.completed > 0 && (
                  <span style={{ background: '#f6ffed', color: '#52c41a', padding: '0 6px', borderRadius: 8, fontSize: 11 }}>
                    {counts.completed}{isMobile ? '完成' : '已完成'}
                  </span>
                )}
              </span>
            )}
          </div>
          {expanded ? <DownOutlined style={{ color: '#999', fontSize: 12 }} /> : <RightOutlined style={{ color: '#999', fontSize: 12 }} />}
        </div>

        {expanded && (
          <div style={{ padding: isMobile ? '0 12px 8px' : '0 16px 12px' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 20 }}><Spin size="small" /></div>
            ) : (
              <>
                {items.map((item) => {
                  const cfg = statusConfig[item.status] || statusConfig.pending;
                  const isHighlight = highlightFollowUpId === item.id || lastSavedId === item.id;
                  return (
                    <div
                      key={item.id}
                      ref={highlightFollowUpId === item.id ? highlightRef : undefined}
                      className={isHighlight ? 'followup-highlight' : ''}
                      style={{ padding: isMobile ? '8px 0' : '10px 0', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ background: cfg.bg, color: cfg.color, padding: '1px 8px', borderRadius: 10, fontSize: 11 }}>{cfg.label}</span>
                        {item.is_recovered
                          ? <span style={{ background: '#f6ffed', color: '#52c41a', padding: '0 5px', borderRadius: 3, fontSize: 10, marginLeft: 4 }}>已康复</span>
                          : <span style={{ background: '#fff7e6', color: '#fa8c16', padding: '0 5px', borderRadius: 3, fontSize: 10, marginLeft: 4 }}>未康复</span>
                        }
                        <span style={{ marginLeft: 6, fontSize: 13 }}>{item.planned_date}</span>
                        <span style={{ marginLeft: 6, fontSize: 12, color: '#666' }}>
                          {item.patient_phone || patientPhone || '暂无电话'}
                        </span>
                        {item.content && !/^已[经]?康复$/.test(item.content.trim()) && (
                          <div style={{ color: '#888', fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {item.content}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 8 }}>
                        {item.status !== 'completed' && hasPermission('followup:update') && (
                          <a style={{ color: '#52c41a', fontSize: 12 }} onClick={() => handleComplete(item)}>完成</a>
                        )}
                        {hasPermission('followup:update') && (
                          <a style={{ color: '#1677ff', fontSize: 12 }} onClick={() => handleEdit(item)}>
                            {item.status === 'completed' ? '查看' : '编辑'}
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
                {hasPermission('followup:create') && (
                  <div style={{ padding: isMobile ? '8px 0' : '12px 0', textAlign: 'center' }}>
                    <div
                      onClick={handleAdd}
                      style={{ display: 'inline-block', padding: '4px 16px', border: '1px dashed #d9d9d9', borderRadius: 6, color: '#1677ff', fontSize: 13, cursor: 'pointer' }}
                    >
                      <PlusOutlined style={{ marginRight: 4 }} /> 新建回访
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <Modal
        title={editing ? '编辑回访' : '新建回访'}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => setModalOpen(false)}
        confirmLoading={confirmLoading}
        width={isMobile ? 'calc(100vw - 32px)' : 520}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
            患者：{patientName}
          </div>
          <Form.Item name="planned_date" label="计划回访日期" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="method" label="回访方式" rules={[{ required: true, message: '请选择方式' }]}>
            <Select options={METHOD_OPTIONS} onChange={(v) => setIsOtherMethod(v === '其他')} />
          </Form.Item>
          {isOtherMethod && (
            <Form.Item name="custom_method" label="自定义方式" rules={[{ required: true, message: '请输入方式' }]}>
              <Input maxLength={50} />
            </Form.Item>
          )}
          {editing && (
            <Form.Item name="actual_date" label="实际回访日期" extra="清空此日期后，状态将恢复为待回访">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          )}
          {editing && (
            <Form.Item name="is_recovered" label="是否康复" valuePropName="checked">
              <Switch checkedChildren="已康复" unCheckedChildren="未康复" />
            </Form.Item>
          )}
          <Form.Item name="content" label="回访内容">
            <TextArea rows={4} maxLength={2000} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <style>{`
        @keyframes followup-highlight {
          0% { background-color: #f6ffed; box-shadow: inset 0 0 0 2px #52c41a; }
          100% { background-color: transparent; box-shadow: none; }
        }
        .followup-highlight {
          animation: followup-highlight 3s ease-out;
          border-radius: 6px;
          padding-left: 8px !important;
          padding-right: 8px !important;
        }
      `}</style>
    </>
  );
}
