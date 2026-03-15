import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Table, Button, Space, Input, Select, Modal, Form, DatePicker, message, Tag, Statistic, Row, Col, Popconfirm, Pagination } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';
import { listFollowUps, createFollowUp, updateFollowUp, deleteFollowUp, getFollowUpStats } from '../../api/followUp';
import type { FollowUpListItem, FollowUpStats, CreateFollowUpReq, UpdateFollowUpReq } from '../../api/followUp';
import { listPatients } from '../../api/patient';
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
  const [params, setParams] = useState({ page: 1, size: 20, patient_name: '', status: '', planned_date_from: '', planned_date_to: '' });
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

  const handleEdit = (record: FollowUpListItem) => {
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
      record_id: record.record_id,
      planned_date: record.planned_date ? dayjs(record.planned_date) : undefined,
      actual_date: record.actual_date ? dayjs(record.actual_date) : undefined,
      method: isOther ? '其他' : record.method,
      custom_method: isOther ? record.method : undefined,
      content: record.content,
    });
    handlePatientChange(record.patient_id);
    setModalOpen(true);
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
          record_id: values.record_id ?? null,
          planned_date: values.planned_date?.format('YYYY-MM-DD'),
          actual_date: values.actual_date?.format('YYYY-MM-DD') ?? null,
          method,
          content: values.content || '',
        };
        await updateFollowUp(editing.id, req);
        message.success('更新成功');
      } else {
        const req: CreateFollowUpReq = {
          patient_id: values.patient_id,
          record_id: values.record_id ?? undefined,
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
  const columns: ColumnsType<FollowUpListItem> = [
    {
      title: '患者姓名', dataIndex: 'patient_name', key: 'patient_name', width: 100,
      render: (name: string, record) => (
        name === '已删除'
          ? <span style={{ color: '#999' }}>{name}</span>
          : <a onClick={() => navigate(`/patients/${record.patient_id}`)}>{name}</a>
      ),
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
    { title: '计划日期', dataIndex: 'planned_date', key: 'planned_date', width: 110 },
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
    { title: '回访方式', dataIndex: 'method', key: 'method', width: 80 },
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
  ];

  // Mobile card
  const renderMobileCard = (item: FollowUpListItem) => {
    const cfg = statusConfig[item.status] || statusConfig.pending;
    return (
      <Card key={item.id} size="small" style={{ marginBottom: 8, borderLeft: item.status === 'overdue' ? '3px solid #ff4d4f' : undefined }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <a onClick={() => navigate(`/patients/${item.patient_id}`)} style={{ fontWeight: 500 }}>{item.patient_name}</a>
          <Tag color={cfg.color}>{cfg.label}</Tag>
        </div>
        <div style={{ color: '#666', fontSize: 13 }}>
          计划: {item.planned_date} | 方式: {item.method}
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

  // Search bar
  const renderSearchBar = () => (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
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
        style={{ width: isMobile ? '100%' : 120 }}
        allowClear
      >
        <Option value="pending">待回访</Option>
        <Option value="overdue">逾期</Option>
        <Option value="completed">已完成</Option>
      </Select>
      {!isMobile && (
        <RangePicker
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
      {hasPermission('followup:create') && (
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          {isMobile ? '' : '新增回访'}
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
        <Form.Item name="record_id" label="关联诊疗记录">
          <Select allowClear placeholder="选择诊疗记录（可选）">
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
