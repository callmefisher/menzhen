import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Table, Button, Space, Input, Select, Modal, Form, DatePicker, message, Tag, Popconfirm, Pagination, Switch, Tooltip } from 'antd';
import { PlusOutlined, SearchOutlined, CaretUpOutlined, CaretDownOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';
import { listFollowUps, createFollowUp, updateFollowUp, deleteFollowUp, getFollowUpStats, findFollowUpPage } from '../../api/followUp';
import type { FollowUpListItem, FollowUpStats, CreateFollowUpReq, UpdateFollowUpReq } from '../../api/followUp';
import { listPatients, getPatient } from '../../api/patient';
import { listRecords } from '../../api/record';
import dayjs from 'dayjs';

const { Option } = Select;
const { TextArea } = Input;
const { RangePicker } = DatePicker;

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: '待回访', color: 'blue' },
  completed: { label: '已完成', color: 'green' },
  overdue: { label: '逾期', color: 'red' },
};

import { recoveredTagStyle, notRecoveredTagStyle } from '../../utils/followUpStyles';

// Pill tabs: Row 1 = status, Row 2 = recovery
type StatusTab = 'all' | 'pending' | 'overdue' | 'completed';
type RecoveryTab = '' | 'recovered' | 'not_recovered';

const statusTabs: { key: StatusTab; label: string; bgActive: string; colorActive: string; statsKey: keyof FollowUpStats }[] = [
  { key: 'all', label: '全部', bgActive: '#1677ff', colorActive: '#fff', statsKey: 'total_count' },
  { key: 'pending', label: '待回访', bgActive: '#e6f4ff', colorActive: '#1677ff', statsKey: 'pending_count' },
  { key: 'overdue', label: '逾期', bgActive: '#fff2f0', colorActive: '#ff4d4f', statsKey: 'overdue_count' },
  { key: 'completed', label: '已完成', bgActive: '#f6ffed', colorActive: '#52c41a', statsKey: 'completed_count' },
];

// Quick date range helpers
type QuickRangeKey = 'today' | 'week' | 'month';
const getQuickRange = (key: QuickRangeKey): [string, string] => {
  const today = dayjs();
  switch (key) {
    case 'today':
      return [today.format('YYYY-MM-DD'), today.format('YYYY-MM-DD')];
    case 'week': {
      const d = today.day();
      const diffToMonday = d === 0 ? 6 : d - 1;
      const monday = today.subtract(diffToMonday, 'day');
      const sunday = monday.add(6, 'day');
      return [monday.format('YYYY-MM-DD'), sunday.format('YYYY-MM-DD')];
    }
    case 'month':
      return [today.startOf('month').format('YYYY-MM-DD'), today.endOf('month').format('YYYY-MM-DD')];
  }
};

export default function FollowUpList() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  // List state
  const [data, setData] = useState<FollowUpListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [params, setParams] = useState({ page: 1, size: 20, patient_name: '', status: '', is_recovered: '' as '' | 'true' | 'false', planned_date_from: '', planned_date_to: '', sort_order: 'asc' as 'asc' | 'desc' });
  const [stats, setStats] = useState<FollowUpStats>({ pending_count: 0, overdue_count: 0, today_count: 0, completed_count: 0, total_count: 0 });
  const [activeStatusTab, setActiveStatusTab] = useState<StatusTab>('all');
  const [activeRecoveryTab, setActiveRecoveryTab] = useState<RecoveryTab>('');
  const [lastSavedId, setLastSavedId] = useState<number | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FollowUpListItem | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [form] = Form.useForm();

  // Patient/Record select state
  const [patients, setPatients] = useState<{ id: number; name: string }[]>([]);
  const [patientRecords, setPatientRecords] = useState<{ id: number; diagnosis: string; visit_date: string }[]>([]);
  const [isOtherMethod, setIsOtherMethod] = useState(false);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listFollowUps(params);
      const body = res as any;
      setData(body.data?.list || []);
      setTotal(body.data?.total || 0);
    } catch { /* interceptor handles */ }
    finally { setLoading(false); }
  }, [params]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await getFollowUpStats();
      const body = res as any;
      if (body.data) setStats(body.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Highlight: if saved row not in current page after data refresh, use findFollowUpPage to locate it
  useEffect(() => {
    if (!lastSavedId) return;
    const inCurrentPage = data.some(item => item.id === lastSavedId);
    if (inCurrentPage) {
      // Scroll to highlighted row
      const doScroll = () => {
        const el = document.getElementById(`followup-row-${lastSavedId}`);
        el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      };
      let scrollCleanup: (() => void) | undefined;
      if (isMobile) {
        const t = setTimeout(doScroll, 500);
        scrollCleanup = () => clearTimeout(t);
      } else {
        let cancelled = false;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => { if (!cancelled) doScroll(); });
        });
        scrollCleanup = () => { cancelled = true; };
      }
      const timer = setTimeout(() => setLastSavedId(null), 5000);
      return () => { scrollCleanup?.(); clearTimeout(timer); };
    } else if (data.length > 0) {
      // Row not on current page — ask backend which page it's on (once)
      findFollowUpPage(lastSavedId, params.size)
        .then((res) => {
          const body = res as any;
          const targetPage = body.data?.page || 1;
          if (targetPage !== params.page) {
            setParams(p => ({ ...p, page: targetPage }));
          } else {
            // Already on the target page but row not found — give up highlight
            setLastSavedId(null);
          }
        })
        .catch(() => { setLastSavedId(null); });
      // Clear highlight as fallback after 5s
      const timer = setTimeout(() => setLastSavedId(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [lastSavedId, data, isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  // 电话为空的回访项，逐个查询患者电话并回填
  useEffect(() => {
    let cancelled = false;
    const emptyPhoneItems = data.filter((item) => !item.patient_phone && item.patient_id);
    if (emptyPhoneItems.length === 0) return;
    const uniquePatientIds = [...new Set(emptyPhoneItems.map((item) => item.patient_id))];
    uniquePatientIds.forEach(async (pid) => {
      try {
        const res = await getPatient(pid);
        if (cancelled) return;
        const body = res as any;
        const phone = body.data?.phone;
        if (phone) {
          setData((prev) => prev.map((item) =>
            item.patient_id === pid && !item.patient_phone ? { ...item, patient_phone: phone } : item
          ));
        }
      } catch { /* ignore */ }
    });
    return () => { cancelled = true; };
  }, [data.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Patient search for modal
  const searchPatients = async (name: string) => {
    if (!name || name.length < 1) return;
    try {
      const res = await listPatients({ name, size: 20 });
      const body = res as any;
      setPatients((body.data?.list || []).map((p: any) => ({ id: p.id, name: p.name })));
    } catch { /* ignore */ }
  };

  // Load records when patient changes
  const handlePatientChange = async (patientId: number) => {
    form.setFieldValue('record_id', undefined);
    setPatientRecords([]);
    try {
      const res = await listRecords({ patient_id: patientId, size: 100 });
      const body = res as any;
      setPatientRecords((body.data?.list || []).map((r: any) => ({
        id: r.id, diagnosis: r.diagnosis || r.chief_complaint || '未填写', visit_date: r.visit_date,
      })));
    } catch { /* ignore */ }
  };

  // Quick date range
  const activeQuickRange = useMemo(() => {
    const { planned_date_from: from, planned_date_to: to } = params;
    if (!from && !to) return '';
    for (const key of ['today', 'week', 'month'] as const) {
      const [qf, qt] = getQuickRange(key);
      if (from === qf && to === qt) return key;
    }
    return 'custom';
  }, [params.planned_date_from, params.planned_date_to]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleQuickRange = (key: QuickRangeKey) => {
    if (activeQuickRange === key) {
      setParams({ ...params, planned_date_from: '', planned_date_to: '', page: 1 });
    } else {
      const [from, to] = getQuickRange(key);
      setParams({ ...params, planned_date_from: from, planned_date_to: to, status: '', page: 1 });
      setActiveStatusTab('all');
    }
  };

  // Status tab click
  const handleStatusTabClick = (tab: StatusTab) => {
    if (tab === activeStatusTab) {
      setActiveStatusTab('all');
      setParams({ ...params, status: '', planned_date_from: '', planned_date_to: '', page: 1 });
      return;
    }
    setActiveStatusTab(tab);
    switch (tab) {
      case 'all':
        setParams({ ...params, status: '', planned_date_from: '', planned_date_to: '', page: 1 });
        break;
      case 'pending':
        setParams({ ...params, status: 'pending', planned_date_from: '', planned_date_to: '', page: 1 });
        break;
      case 'overdue':
        setParams({ ...params, status: 'overdue', planned_date_from: '', planned_date_to: '', page: 1 });
        break;
      case 'completed':
        setParams({ ...params, status: 'completed', planned_date_from: '', planned_date_to: '', page: 1 });
        break;
    }
  };

  // Recovery tab click
  const handleRecoveryTabClick = (tab: RecoveryTab) => {
    if (tab === activeRecoveryTab) {
      setActiveRecoveryTab('');
      setParams({ ...params, is_recovered: '', page: 1 });
      return;
    }
    setActiveRecoveryTab(tab);
    setParams({ ...params, is_recovered: tab === 'recovered' ? 'true' : 'false', page: 1 });
  };

  // CRUD handlers
  const handleAdd = () => {
    form.resetFields();
    setEditing(null);
    setIsOtherMethod(false);
    setPatientRecords([]);
    setModalOpen(true);
  };

  const handleEdit = async (record: FollowUpListItem) => {
    setEditing(record);
    const isOther = !['电话', '微信', '到诊'].includes(record.method);
    setIsOtherMethod(isOther);
    setPatients((prev) => {
      const exists = prev.some((p) => p.id === record.patient_id);
      return exists ? prev : [...prev, { id: record.patient_id, name: record.patient_name }];
    });
    form.setFieldsValue({
      patient_id: record.patient_id,
      planned_date: record.planned_date ? dayjs(record.planned_date) : undefined,
      actual_date: record.actual_date ? dayjs(record.actual_date) : undefined,
      method: isOther ? '其他' : record.method,
      custom_method: isOther ? record.method : undefined,
      content: record.content,
      is_recovered: record.is_recovered,
    });
    await handlePatientChange(record.patient_id);
    form.setFieldValue('record_id', record.record_id);
    setModalOpen(true);

    if (!record.patient_phone && record.patient_id) {
      try {
        const res = await getPatient(record.patient_id);
        const body = res as any;
        const phone = body.data?.phone;
        if (phone) {
          setData((prev) => prev.map((item) =>
            item.id === record.id ? { ...item, patient_phone: phone } : item
          ));
        }
      } catch { /* ignore */ }
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteFollowUp(id);
      message.success('删除成功');
      fetchData();
      fetchStats();
      window.dispatchEvent(new Event('followup-data-changed'));
    } catch { message.error('删除失败'); }
  };

  const handleModalOk = async () => {
    const values = await form.validateFields();
    setConfirmLoading(true);
    try {
      const method = values.method === '其他' ? (values.custom_method || '其他') : values.method;
      let savedId: number | null = null;
      if (editing) {
        const req: UpdateFollowUpReq = {
          patient_id: values.patient_id,
          record_id: values.record_id,
          planned_date: values.planned_date?.format('YYYY-MM-DD'),
          actual_date: values.actual_date ? values.actual_date.format('YYYY-MM-DD') : '',
          method,
          content: values.content || '',
          is_recovered: values.is_recovered ?? false,
        };
        await updateFollowUp(editing.id, req);
        message.success('更新成功');
        savedId = editing.id;
      } else {
        const req: CreateFollowUpReq = {
          patient_id: values.patient_id,
          record_id: values.record_id,
          planned_date: values.planned_date.format('YYYY-MM-DD'),
          method,
          content: values.content || '',
        };
        const res = await createFollowUp(req);
        const body = res as any;
        message.success('新增成功');
        savedId = body.data?.id || null;
      }
      setModalOpen(false);
      fetchStats();
      window.dispatchEvent(new Event('followup-data-changed'));
      if (savedId) {
        setLastSavedId(savedId);
        // Refresh current page first, then check if saved row is still here
        fetchData();
      } else {
        fetchData();
      }
    } catch { message.error('操作失败'); }
    finally { setConfirmLoading(false); }
  };

  // Table columns (desktop)
  // Deps: sort_order for header UI; handlers use stable setState/form refs so safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const columns: ColumnsType<FollowUpListItem> = useMemo(() => [
    {
      title: '患者', dataIndex: 'patient_name', key: 'patient_name', width: 90,
      render: (name: string, record) => (
        <div>
          {name === '已删除'
            ? <span style={{ color: '#999' }}>{name}</span>
            : <a style={{ color: '#1677ff' }} onClick={() => navigate(`/patients/${record.patient_id}`)}>{name}</a>
          }
          <div style={{ marginTop: 2 }}>
            <span style={record.is_recovered ? recoveredTagStyle : notRecoveredTagStyle}>
              {record.is_recovered ? '已康复' : '未康复'}
            </span>
          </div>
        </div>
      ),
    },
    {
      title: '联系电话', dataIndex: 'patient_phone', key: 'patient_phone', width: 130,
      render: (phone: string) => phone || '—',
    },
    {
      title: '关联诊疗', key: 'record', width: 180,
      render: (_, record) => {
        if (!record.record_id) return '—';
        if (!record.record_diagnosis) return <span style={{ color: '#999' }}>已删除</span>;
        const short = record.record_diagnosis.length > 20
          ? record.record_diagnosis.slice(0, 20) + '...'
          : record.record_diagnosis;
        return (
          <div>
            <div title={record.record_diagnosis} style={{ fontSize: 13, color: '#333' }}>
              {short}
            </div>
            <a
              style={{ fontSize: 12 }}
              onClick={() => navigate(`/records/${record.record_id}?followup_id=${record.id}`)}
            >
              {record.record_visit_date} 详情 →
            </a>
          </div>
        );
      },
    },
    {
      title: (
        <span
          style={{ cursor: 'pointer', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 }}
          onClick={() => setParams((p) => ({ ...p, sort_order: p.sort_order === 'asc' ? 'desc' : 'asc', page: 1 }))}
        >
          日期
          <span style={{ display: 'inline-flex', flexDirection: 'column', fontSize: 10, lineHeight: 1 }}>
            <CaretUpOutlined style={{ color: params.sort_order === 'asc' ? '#1677ff' : '#bbb' }} />
            <CaretDownOutlined style={{ color: params.sort_order === 'desc' ? '#1677ff' : '#bbb', marginTop: -2 }} />
          </span>
        </span>
      ),
      key: 'dates', width: 160,
      render: (_, record) => (
        <div style={{ fontSize: 12 }}>
          <div>计划: {record.planned_date}</div>
          <div style={{ color: record.actual_date ? '#52c41a' : '#999' }}>到访: {record.actual_date || '—'}</div>
        </div>
      ),
    },
    {
      title: '状态', key: 'status', width: 75,
      render: (_, record) => {
        const cfg = statusConfig[record.status] || statusConfig.pending;
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '回访内容', dataIndex: 'content', key: 'content', ellipsis: true,
      render: (content: string) => content ? (
        <Tooltip title={content}>
          <span style={{ color: '#666' }}>{content}</span>
        </Tooltip>
      ) : '—',
    },
    {
      title: '操作', key: 'action', width: 100,
      render: (_, record) => (
        <Space size="small">
          {hasPermission('followup:update') && (
            <Button type="link" size="small" onClick={() => handleEdit(record)}>编辑</Button>
          )}
          {hasPermission('followup:delete') && (
            <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
              <Button type="link" size="small" danger>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ], [params.sort_order]);

  // Mobile sort toggle
  const renderMobileSortBar = () => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ color: '#666', fontSize: 13 }}>共 {total} 条</span>
      <Button
        size="small"
        type="text"
        onClick={() => setParams((p) => ({ ...p, sort_order: p.sort_order === 'asc' ? 'desc' : 'asc', page: 1 }))}
        icon={params.sort_order === 'asc' ? <CaretUpOutlined /> : <CaretDownOutlined />}
      >
        计划日期{params.sort_order === 'asc' ? '升序' : '降序'}
      </Button>
    </div>
  );

  // Mobile card
  const renderMobileCard = (item: FollowUpListItem) => {
    const cfg = statusConfig[item.status] || statusConfig.pending;
    const isHighlighted = item.id === lastSavedId;
    const isOverdue = item.status === 'overdue';
    return (
      <div key={item.id} id={`followup-row-${item.id}`}>
      <Card
        size="small"
        style={{
          marginBottom: 8,
          ...(isOverdue ? { background: '#ffe8e6' } : {}),
          ...(isHighlighted ? { outline: '2px solid #52c41a', outlineOffset: -2, background: isOverdue ? '#ffe8e6' : '#f6ffed' } : {}),
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <a style={{ color: '#1677ff', fontWeight: 500 }} onClick={() => navigate(`/patients/${item.patient_id}`)}>{item.patient_name}</a>
          <Space size={4}>
            <span style={item.is_recovered ? { ...recoveredTagStyle, fontSize: 11 } : { ...notRecoveredTagStyle, fontSize: 11 }}>
              {item.is_recovered ? '已康复' : '未康复'}
            </span>
            <Tag color={cfg.color}>{cfg.label}</Tag>
          </Space>
        </div>
        <div style={{ color: '#666', fontSize: 13 }}>
          计划: {item.planned_date}
          {item.patient_phone && <> | 电话: <a href={`tel:${item.patient_phone}`}>{item.patient_phone}</a></>}
          {item.actual_date && ` | 实际: ${item.actual_date}`}
        </div>
        {item.record_id && item.record_diagnosis && (
          <div style={{ marginTop: 4, fontSize: 13 }}>
            <span style={{ color: '#666' }}>
              诊疗: {item.record_diagnosis.slice(0, 20)}{item.record_diagnosis.length > 20 ? '...' : ''}
            </span>
            <a onClick={() => navigate(`/records/${item.record_id}?followup_id=${item.id}`)} style={{ marginLeft: 6, fontSize: 12 }}>
              查看 →
            </a>
          </div>
        )}
        {item.content && <div style={{ marginTop: 4, color: '#888', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.content}</div>}
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          {hasPermission('followup:update') && <Button size="small" onClick={() => handleEdit(item)}>编辑</Button>}
          {hasPermission('followup:delete') && (
            <Popconfirm title="确定删除？" onConfirm={() => handleDelete(item.id)}>
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          )}
        </div>
      </Card>
      </div>
    );
  };

  // Two-row pill tabs
  const renderPillTabs = () => (
    <div style={{ marginBottom: 16 }}>
      {/* Row 1: status tabs */}
      <div style={{
        display: 'flex',
        gap: isMobile ? 6 : 10,
        marginBottom: 8,
        ...(isMobile ? { overflowX: 'auto', whiteSpace: 'nowrap' as const, flexWrap: 'nowrap' as const, paddingBottom: 4 } : { flexWrap: 'wrap' as const }),
      }}>
        {statusTabs.map(({ key, label, bgActive, colorActive, statsKey }) => {
          const isActive = activeStatusTab === key;
          return (
            <div
              key={key}
              onClick={() => handleStatusTabClick(key)}
              style={{
                padding: isMobile ? '4px 12px' : '7px 20px',
                background: isActive ? bgActive : '#f5f5f5',
                color: isActive ? colorActive : '#666',
                borderRadius: 20,
                fontSize: isMobile ? 12 : 15,
                cursor: 'pointer',
                fontWeight: isActive ? 500 : 400,
                flexShrink: 0,
                transition: 'all 0.2s',
                userSelect: 'none' as const,
              }}
            >
              {label} {stats[statsKey] ?? 0}
            </div>
          );
        })}
      </div>
      {/* Row 2: recovery tabs */}
      <div style={{ display: 'flex', gap: isMobile ? 6 : 10, alignItems: 'center' }}>
        <span style={{ color: '#999', fontSize: isMobile ? 11 : 13 }}>康复:</span>
        <div
          onClick={() => handleRecoveryTabClick('recovered')}
          style={{
            padding: isMobile ? '3px 10px' : '5px 16px',
            background: activeRecoveryTab === 'recovered' ? '#f6ffed' : '#f5f5f5',
            color: activeRecoveryTab === 'recovered' ? '#389e0d' : '#666',
            borderRadius: 20,
            fontSize: isMobile ? 11 : 14,
            cursor: 'pointer',
            fontWeight: activeRecoveryTab === 'recovered' ? 500 : 400,
            border: activeRecoveryTab === 'recovered' ? '1px solid #b7eb8f' : '1px solid transparent',
            transition: 'all 0.2s',
            userSelect: 'none' as const,
          }}
        >
          已康复
        </div>
        <div
          onClick={() => handleRecoveryTabClick('not_recovered')}
          style={{
            padding: isMobile ? '3px 10px' : '5px 16px',
            background: activeRecoveryTab === 'not_recovered' ? '#fff7e6' : '#f5f5f5',
            color: activeRecoveryTab === 'not_recovered' ? '#d46b08' : '#666',
            borderRadius: 20,
            fontSize: isMobile ? 11 : 14,
            cursor: 'pointer',
            fontWeight: activeRecoveryTab === 'not_recovered' ? 500 : 400,
            border: activeRecoveryTab === 'not_recovered' ? '1px solid #ffd591' : '1px solid transparent',
            transition: 'all 0.2s',
            userSelect: 'none' as const,
          }}
        >
          未康复
        </div>
      </div>
    </div>
  );

  // Search bar
  const renderSearchBar = () => (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center', ...(isMobile ? { overflow: 'hidden' } : {}) }}>
      <Input
        placeholder="患者姓名"
        prefix={<SearchOutlined />}
        value={params.patient_name}
        onChange={(e) => setParams({ ...params, patient_name: e.target.value, page: 1 })}
        style={{ width: isMobile ? '100%' : 200 }}
        allowClear
      />
      {isMobile && hasPermission('followup:create') && (
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} style={{ width: 'calc(50% - 4px)' }} aria-label="新增回访" />
      )}
      <Space.Compact size={isMobile ? 'small' : 'middle'}>
        {([
          { key: 'today' as const, label: '今日' },
          { key: 'week' as const, label: '本周' },
          { key: 'month' as const, label: '本月' },
        ]).map(({ key, label }) => (
          <Button
            key={key}
            type={activeQuickRange === key ? 'primary' : 'default'}
            onClick={() => handleQuickRange(key)}
          >
            {label}
          </Button>
        ))}
      </Space.Compact>
      {isMobile ? (
        <div style={{ display: 'flex', gap: 4, width: '100%' }}>
          <DatePicker
            size="small"
            placeholder="开始日期"
            value={params.planned_date_from ? dayjs(params.planned_date_from) : undefined}
            onChange={(d) => {
              const from = d?.format('YYYY-MM-DD') || '';
              const to = from && params.planned_date_to && from > params.planned_date_to ? '' : params.planned_date_to;
              setParams({ ...params, planned_date_from: from, planned_date_to: to, page: 1 });
              setActiveStatusTab('all');
            }}
            disabledDate={params.planned_date_to ? (d) => d.isAfter(dayjs(params.planned_date_to), 'day') : undefined}
            style={{ flex: 1, minWidth: 0 }}
            allowClear
          />
          <DatePicker
            size="small"
            placeholder="结束日期"
            value={params.planned_date_to ? dayjs(params.planned_date_to) : undefined}
            onChange={(d) => {
              const to = d?.format('YYYY-MM-DD') || '';
              const from = to && params.planned_date_from && to < params.planned_date_from ? '' : params.planned_date_from;
              setParams({ ...params, planned_date_from: from, planned_date_to: to, page: 1 });
              setActiveStatusTab('all');
            }}
            disabledDate={params.planned_date_from ? (d) => d.isBefore(dayjs(params.planned_date_from), 'day') : undefined}
            style={{ flex: 1, minWidth: 0 }}
            allowClear
          />
        </div>
      ) : (
        <RangePicker
          value={
            params.planned_date_from && params.planned_date_to
              ? [dayjs(params.planned_date_from), dayjs(params.planned_date_to)]
              : undefined
          }
          onChange={(dates) => {
            setParams({
              ...params,
              planned_date_from: dates?.[0]?.format('YYYY-MM-DD') || '',
              planned_date_to: dates?.[1]?.format('YYYY-MM-DD') || '',
              page: 1,
            });
            setActiveStatusTab('all');
          }}
        />
      )}
      {!isMobile && hasPermission('followup:create') && (
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          新增回访
        </Button>
      )}
    </div>
  );

  // Modal form
  const renderModal = () => (
    <Modal
      title={editing ? '编辑回访' : '新增回访'}
      open={modalOpen}
      onOk={handleModalOk}
      onCancel={() => setModalOpen(false)}
      confirmLoading={confirmLoading}
      width={isMobile ? 'calc(100vw - 32px)' : 560}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="patient_id" label="患者" rules={[{ required: true, message: '请选择患者' }]}>
          <Select
            showSearch
            filterOption={false}
            onSearch={searchPatients}
            onChange={handlePatientChange}
            placeholder="搜索患者姓名"
          >
            {patients.map((p) => <Option key={p.id} value={p.id}>{p.name}</Option>)}
          </Select>
        </Form.Item>
        <Form.Item name="record_id" label="关联诊疗记录" rules={[{ required: true, message: '请选择诊疗记录' }]}>
          <Select placeholder="选择诊疗记录">
            {patientRecords.map((r) => (
              <Option key={r.id} value={r.id}>{r.diagnosis} ({r.visit_date})</Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item name="planned_date" label="计划回访日期" rules={[{ required: true, message: '请选择日期' }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="method" label="回访方式" rules={[{ required: true, message: '请选择方式' }]}>
          <Select onChange={(v) => setIsOtherMethod(v === '其他')}>
            <Option value="电话">电话</Option>
            <Option value="微信">微信</Option>
            <Option value="到诊">到诊</Option>
            <Option value="其他">其他</Option>
          </Select>
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
  );

  return (
    <>
      {renderPillTabs()}
      {renderSearchBar()}
      {isMobile ? (
        <>
          {renderMobileSortBar()}
          {data.map(renderMobileCard)}
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Pagination
              size="small"
              simple
              current={params.page}
              pageSize={params.size}
              total={total}
              onChange={(page) => { setLastSavedId(null); setParams({ ...params, page }); }}
            />
          </div>
        </>
      ) : (
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          rowClassName={(record) => {
            const cls: string[] = [];
            if (record.status === 'overdue') cls.push('follow-up-overdue-row');
            if (record.id === lastSavedId) cls.push('followup-saved-highlight');
            return cls.join(' ');
          }}
          onRow={(record) => ({
            id: `followup-row-${record.id}`,
          })}
          pagination={{
            current: params.page,
            pageSize: params.size,
            total,
            onChange: (page, size) => { setLastSavedId(null); setParams({ ...params, page, size }); },
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
          }}
        />
      )}
      {renderModal()}
      <style>{`
        .follow-up-overdue-row > td.ant-table-cell { background: #ffe8e6 !important; }
        .followup-saved-highlight > td.ant-table-cell {
          background: #f6ffed !important;
          box-shadow: inset 0 2px 0 #52c41a, inset 0 -2px 0 #52c41a;
        }
        .followup-saved-highlight > td.ant-table-cell:first-child {
          box-shadow: inset 2px 2px 0 #52c41a, inset 0 -2px 0 #52c41a;
        }
        .followup-saved-highlight > td.ant-table-cell:last-child {
          box-shadow: inset -2px 2px 0 #52c41a, inset 0 -2px 0 #52c41a;
        }
        .follow-up-overdue-row.followup-saved-highlight > td.ant-table-cell {
          background: #f6ffed !important;
        }
      `}</style>
    </>
  );
}
