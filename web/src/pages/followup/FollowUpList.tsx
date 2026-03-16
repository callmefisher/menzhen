import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Table, Button, Space, Input, Select, Modal, Form, DatePicker, message, Tag, Statistic, Row, Col, Popconfirm, Pagination, Switch } from 'antd';
import { PlusOutlined, SearchOutlined, CaretUpOutlined, CaretDownOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';
import { listFollowUps, createFollowUp, updateFollowUp, deleteFollowUp, getFollowUpStats } from '../../api/followUp';
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

export default function FollowUpList() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  // List state
  const [data, setData] = useState<FollowUpListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [params, setParams] = useState({ page: 1, size: 20, patient_name: '', status: '', planned_date_from: '', planned_date_to: '', sort_order: 'asc' as 'asc' | 'desc' });
  const [stats, setStats] = useState<FollowUpStats>({ pending_count: 0, overdue_count: 0, today_count: 0, completed_count: 0 });

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
      window.dispatchEvent(new Event('followup-data-changed'));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // 电话为空的回访项，逐个查询患者电话并回填
  useEffect(() => {
    const emptyPhoneItems = data.filter((item) => !item.patient_phone && item.patient_id);
    if (emptyPhoneItems.length === 0) return;
    // 按 patient_id 去重
    const uniquePatientIds = [...new Set(emptyPhoneItems.map((item) => item.patient_id))];
    uniquePatientIds.forEach(async (pid) => {
      try {
        const res = await getPatient(pid);
        const body = res as any;
        const phone = body.data?.phone;
        if (phone) {
          setData((prev) => prev.map((item) =>
            item.patient_id === pid && !item.patient_phone ? { ...item, patient_phone: phone } : item
          ));
        }
      } catch { /* ignore */ }
    });
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
    // 确保患者列表包含当前患者，这样 Select 能显示名字而非 ID
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
    // 先加载诊疗记录列表，再回填 record_id（避免被 handlePatientChange 清空）
    await handlePatientChange(record.patient_id);
    form.setFieldValue('record_id', record.record_id);
    setModalOpen(true);

    // 电话为空时，重新查询患者电话并更新列表数据
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
    } catch { message.error('删除失败'); }
  };

  const handleModalOk = async () => {
    const values = await form.validateFields();
    setConfirmLoading(true);
    try {
      const method = values.method === '其他' ? (values.custom_method || '其他') : values.method;
      if (editing) {
        const req: UpdateFollowUpReq = {
          patient_id: values.patient_id,
          record_id: values.record_id,
          planned_date: values.planned_date?.format('YYYY-MM-DD'),
          actual_date: values.actual_date?.format('YYYY-MM-DD') ?? null,
          method,
          content: values.content || '',
          is_recovered: values.is_recovered ?? false,
        };
        await updateFollowUp(editing.id, req);
        message.success('更新成功');
      } else {
        const req: CreateFollowUpReq = {
          patient_id: values.patient_id,
          record_id: values.record_id,
          planned_date: values.planned_date.format('YYYY-MM-DD'),
          method,
          content: values.content || '',
        };
        await createFollowUp(req);
        message.success('新增成功');
      }
      setModalOpen(false);
      fetchData();
      fetchStats();
    } catch { message.error('操作失败'); }
    finally { setConfirmLoading(false); }
  };

  // Table columns (desktop)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const columns: ColumnsType<FollowUpListItem> = useMemo(() => [
    {
      title: '患者姓名', dataIndex: 'patient_name', key: 'patient_name', width: 100,
      render: (name: string, record) => (
        name === '已删除'
          ? <span style={{ color: '#999' }}>{name}</span>
          : <a onClick={() => navigate(`/patients/${record.patient_id}`)}>{name}</a>
      ),
    },
    {
      title: '联系电话', dataIndex: 'patient_phone', key: 'patient_phone', width: 120,
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
              onClick={() => navigate(`/records/${record.record_id}`)}
            >
              {record.record_visit_date} 查看详情 →
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
          计划日期
          <span style={{ display: 'inline-flex', flexDirection: 'column', fontSize: 10, lineHeight: 1 }}>
            <CaretUpOutlined style={{ color: params.sort_order === 'asc' ? '#1677ff' : '#bbb' }} />
            <CaretDownOutlined style={{ color: params.sort_order === 'desc' ? '#1677ff' : '#bbb', marginTop: -2 }} />
          </span>
        </span>
      ),
      dataIndex: 'planned_date', key: 'planned_date', width: 110,
    },
    {
      title: '实际日期', dataIndex: 'actual_date', key: 'actual_date', width: 110,
      render: (v: string | null) => v || '—',
    },
    {
      title: '状态', key: 'status', width: 80,
      render: (_, record) => {
        const cfg = statusConfig[record.status] || statusConfig.pending;
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '康复', key: 'is_recovered', width: 80,
      render: (_, record) => (
        record.is_recovered
          ? <Tag color="green">已康复</Tag>
          : <Tag color="default">未康复</Tag>
      ),
    },
    {
      title: '操作', key: 'action', width: 120,
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
    const borderColor = item.status === 'overdue' ? '#ff4d4f' : item.is_recovered ? '#52c41a' : undefined;
    return (
      <Card key={item.id} size="small" style={{ marginBottom: 8, borderLeft: borderColor ? `3px solid ${borderColor}` : undefined }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <a onClick={() => navigate(`/patients/${item.patient_id}`)} style={{ fontWeight: 500 }}>{item.patient_name}</a>
          <Space size={4}>
            {item.is_recovered && <Tag color="green">已康复</Tag>}
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
            <a onClick={() => navigate(`/records/${item.record_id}`)} style={{ marginLeft: 6, fontSize: 12 }}>
              查看 →
            </a>
          </div>
        )}
        {item.content && <div style={{ marginTop: 4, color: '#888', fontSize: 12 }}>{item.content}</div>}
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          {hasPermission('followup:update') && <Button size="small" onClick={() => handleEdit(item)}>编辑</Button>}
          {hasPermission('followup:delete') && (
            <Popconfirm title="确定删除？" onConfirm={() => handleDelete(item.id)}>
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          )}
        </div>
      </Card>
    );
  };

  // Quick date range helpers
  type QuickRangeKey = 'today' | 'week' | 'month';

  const getQuickRange = (key: QuickRangeKey): [string, string] => {
    const today = dayjs();
    switch (key) {
      case 'today':
        return [today.format('YYYY-MM-DD'), today.format('YYYY-MM-DD')];
      case 'week': {
        // 显式计算本周一~周日，不依赖 locale startOf('week')
        const d = today.day(); // 0=周日, 1=周一, ..., 6=周六
        const diffToMonday = d === 0 ? 6 : d - 1;
        const monday = today.subtract(diffToMonday, 'day');
        const sunday = monday.add(6, 'day');
        return [monday.format('YYYY-MM-DD'), sunday.format('YYYY-MM-DD')];
      }
      case 'month':
        return [today.startOf('month').format('YYYY-MM-DD'), today.endOf('month').format('YYYY-MM-DD')];
    }
  };

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
      // 取消选中
      setParams({ ...params, planned_date_from: '', planned_date_to: '', page: 1 });
    } else {
      const [from, to] = getQuickRange(key);
      setParams({ ...params, planned_date_from: from, planned_date_to: to, page: 1 });
    }
  };

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
      <Select
        value={params.status || undefined}
        placeholder="状态"
        onChange={(v) => setParams({ ...params, status: v || '', page: 1 })}
        style={{ width: isMobile ? 'calc(50% - 4px)' : 120 }}
        allowClear
      >
        <Option value="pending">待回访</Option>
        <Option value="overdue">逾期</Option>
        <Option value="completed">已完成</Option>
      </Select>
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
              // 如果开始日期晚于结束日期，清空结束日期
              const to = from && params.planned_date_to && from > params.planned_date_to ? '' : params.planned_date_to;
              setParams({ ...params, planned_date_from: from, planned_date_to: to, page: 1 });
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
              // 如果结束日期早于开始日期，清空开始日期
              const from = to && params.planned_date_from && to < params.planned_date_from ? '' : params.planned_date_from;
              setParams({ ...params, planned_date_from: from, planned_date_to: to, page: 1 });
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

  // Stats cards
  const renderStats = () => (
    <Row gutter={16} style={{ marginBottom: 16 }}>
      <Col span={isMobile ? 8 : 4}>
        <Card size="small"><Statistic title="待回访" value={stats.pending_count} /></Card>
      </Col>
      <Col span={isMobile ? 8 : 4}>
        <Card size="small"><Statistic title="今日" value={stats.today_count} /></Card>
      </Col>
      <Col span={isMobile ? 8 : 4}>
        <Card size="small"><Statistic title="逾期" value={stats.overdue_count} valueStyle={{ color: '#ff4d4f' }} /></Card>
      </Col>
    </Row>
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
          <Form.Item name="actual_date" label="实际回访日期">
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
      {renderSearchBar()}
      {renderStats()}
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
              onChange={(page) => setParams({ ...params, page })}
            />
          </div>
        </>
      ) : (
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          rowClassName={(record) => record.status === 'overdue' ? 'follow-up-overdue-row' : ''}
          pagination={{
            current: params.page,
            pageSize: params.size,
            total,
            onChange: (page, size) => setParams({ ...params, page, size }),
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
          }}
        />
      )}
      {renderModal()}
      <style>{`.follow-up-overdue-row { background: #fff2f0 !important; }`}</style>
    </>
  );
}
