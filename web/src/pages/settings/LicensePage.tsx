import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, Select, InputNumber,
  Tag, Space, Statistic, Row, Col, DatePicker, message, Spin,
  Descriptions, Timeline, Divider, Alert, Checkbox, Typography, Drawer
} from 'antd';
import {
  KeyOutlined, SafetyCertificateOutlined, ClockCircleOutlined,
  PlusOutlined, CopyOutlined, ReloadOutlined, EditOutlined,
  CheckCircleOutlined, ExclamationCircleOutlined, CloseCircleOutlined,
  BarChartOutlined, HistoryOutlined
} from '@ant-design/icons';
import {
  getSiteLicense, listAllLicenses, createLicense, updateLicense,
  getLicense, getLicenseStats, getKeys,
  listTenantLicenses
} from '../../api/license';
import { searchAccessibleTenants, type AccessibleTenant } from '../../api/tenant';
import useIsMobile from '../../hooks/useIsMobile';
import dayjs from 'dayjs';
import Chart from 'chart.js/auto';

const { RangePicker } = DatePicker;
const { Text, Paragraph } = Typography;

const METHOD_MAP: Record<string, { label: string; color: string }> = {
  day: { label: '按天', color: 'green' },
  week: { label: '按周', color: 'orange' },
  month: { label: '按月', color: 'blue' },
  year: { label: '按年', color: 'purple' },
  permanent: { label: '永久', color: 'cyan' },
};

const FEATURE_MAP: Record<string, { label: string; color: string }> = {
  basic: { label: '基础功能', color: 'green' },
  ai: { label: 'AI增值', color: 'purple' },
  cloud: { label: '云存储', color: 'blue' },
};

function StatusTag({ status }: { status: string; remaining: number }) {
  const config: Record<string, { color: string; icon: React.ReactNode; text: string }> = {
    active: { color: 'green', icon: <CheckCircleOutlined />, text: '有效' },
    expiring: { color: 'orange', icon: <ExclamationCircleOutlined />, text: '即将到期' },
    expired: { color: 'red', icon: <CloseCircleOutlined />, text: '已过期' },
    superseded: { color: 'default', icon: <ClockCircleOutlined />, text: '已续期' },
    none: { color: 'default', icon: <CloseCircleOutlined />, text: '未授权' },
  };
  const c = config[status] || config.none;
  return <Tag color={c.color} icon={c.icon}>{c.text}</Tag>;
}

function RemainingTag({ remaining, method }: { remaining: number; method: string }) {
  if (method === 'permanent') return <Tag color="cyan">∞</Tag>;
  if (remaining <= 0) return <Tag color="red">{remaining}天</Tag>;
  if (remaining <= 7) return <Tag color="orange">{remaining}天</Tag>;
  return <Tag color="green">{remaining}天</Tag>;
}

export default function LicensePage() {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [siteData, setSiteData] = useState<any>(null);
  const [allLicenses, setAllLicenses] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailHistory, setDetailHistory] = useState<any[]>([]);
  const [keysData, setKeysData] = useState<any>(null);
  const [form] = Form.useForm();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'site' | 'tenant'>('site');
  const [tenantOptions, setTenantOptions] = useState<AccessibleTenant[]>([]);
  const [tenantSearch, setTenantSearch] = useState('');
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  const fetchSiteData = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await getSiteLicense();
      setSiteData(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const fetchAllLicenses = useCallback(async () => {
    try {
      const res: any = await listAllLicenses();
      setAllLicenses(res.data || []);
    } catch { /* ignore */ }
  }, []);

  const fetchStats = useCallback(async (start?: string, end?: string) => {
    try {
      const res: any = await getLicenseStats(start, end);
      setStats(res.data);
    } catch { /* ignore */ }
  }, []);

  const fetchKeys = useCallback(async () => {
    try {
      const res: any = await getKeys();
      setKeysData(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchSiteData();
    fetchAllLicenses();
    fetchStats();
    fetchKeys();
  }, [fetchSiteData, fetchAllLicenses, fetchStats, fetchKeys]);

  useEffect(() => {
    if (stats?.monthly && chartCanvasRef.current) {
      if (chartInstanceRef.current) chartInstanceRef.current.destroy();
      const ctx = chartCanvasRef.current.getContext('2d');
      if (ctx) {
        const monthly = stats.monthly || [];
        chartInstanceRef.current = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: monthly.map((m: any) => m.month),
            datasets: [
              { label: '基础功能', data: monthly.map((m: any) => m.basic || 0), backgroundColor: 'rgba(82,196,26,0.7)', borderRadius: 4 },
              { label: 'AI增值', data: monthly.map((m: any) => m.ai || 0), backgroundColor: 'rgba(114,46,209,0.7)', borderRadius: 4 },
              { label: '云存储', data: monthly.map((m: any) => m.cloud || 0), backgroundColor: 'rgba(22,119,255,0.7)', borderRadius: 4 },
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 12 } } },
            scales: {
              x: { stacked: true, grid: { display: false } },
              y: { stacked: true, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { callback: (v: any) => '¥' + v.toLocaleString() } }
            }
          }
        });
      }
    }
  }, [stats]);

  const searchTenants = useCallback(async (keyword: string) => {
    setTenantSearch(keyword);
    if (!keyword) { setTenantOptions([]); return; }
    try {
      const res: any = await searchAccessibleTenants(keyword);
      setTenantOptions(res.data?.list || res.data || []);
    } catch { /* ignore */ }
  }, []);

  const handleCreate = () => {
    setEditingId(null);
    form.resetFields();
    setTenantOptions([]);
    setTenantSearch('');
    form.setFieldsValue({
      method: 'month',
      duration: 1,
      features: ['basic'],
      amount: 0,
      auth_date: dayjs().format('YYYY-MM-DD'),
      site_id: siteData?.site_id || '',
      machine_id: siteData?.machine_id || '',
    });
    setModalVisible(true);
  };

  const handleUpdateSiteLicense = () => {
    if (siteData?.license) {
      handleEdit(siteData.license.id);
    } else {
      handleCreate();
    }
  };

  const handleEdit = async (id: number) => {
    try {
      const res: any = await getLicense(id);
      const lic = res.data?.license;
      if (lic) {
        setEditingId(id);
        let features: string[] = [];
        try { features = JSON.parse(lic.features || '[]'); } catch { /* ignore */ }
        form.setFieldsValue({
          tenant_id: lic.tenant_id,
          site_id: lic.site_id,
          machine_id: lic.machine_id,
          method: lic.method,
          duration: lic.duration || 1,
          auth_date: lic.auth_date ? dayjs(lic.auth_date).format('YYYY-MM-DD') : undefined,
          features,
          amount: lic.amount,
          remark: lic.remark,
          license_token: lic.jwt_token || '',
        });
        setModalVisible(true);
      }
    } catch { message.error('获取授权详情失败'); }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload = { ...values };
      if (editingId) {
        await updateLicense(editingId, payload);
        message.success('授权已更新');
      } else {
        await createLicense(payload);
        message.success('授权已签发');
      }
      setModalVisible(false);
      fetchAllLicenses();
      fetchSiteData();
      fetchStats();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e?.response?.data?.message || '操作失败');
    }
  };

  const handleViewDetail = async (record: any) => {
    try {
      const res: any = await getLicense(record.id);
      setDetailData(res.data);
      const histRes: any = await listTenantLicenses(record.tenant_id);
      setDetailHistory(histRes.data || []);
      setDetailVisible(true);
    } catch { message.error('获取详情失败'); }
  };

  const handleDateRangeChange = (dates: any) => {
    if (dates && dates[0] && dates[1]) {
      fetchStats(dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD'));
    } else {
      fetchStats();
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => message.success('已复制'));
  };

  const siteID = siteData?.site_id || '';
  const machineID = siteData?.machine_id || '';
  const license = siteData?.license;
  const status = siteData?.status || 'none';
  const remaining = siteData?.remaining_days || 0;
  const decoded = siteData?.decoded_claims;
  const summary = stats?.summary;

  const columns = [
    {
      title: '诊所', dataIndex: 'tenant_name', key: 'tenant_name',
      render: (name: string, r: any) => (
        <div>
          <div style={{ fontWeight: 500 }}>{name}</div>
          <div style={{ fontSize: 11, color: '#999' }}>{r.tenant_code}</div>
        </div>
      ),
    },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (s: string) => <StatusTag status={s} remaining={0} />,
    },
    {
      title: '方式', dataIndex: 'method', key: 'method',
      render: (m: string) => {
        const c = METHOD_MAP[m];
        return c ? <Tag color={c.color}>{c.label}</Tag> : m;
      },
    },
    {
      title: '功能', dataIndex: 'features', key: 'features',
      render: (f: string) => {
        let features: string[] = [];
        try { features = JSON.parse(f || '[]'); } catch { /* ignore */ }
        return <Space size={4}>{features.map((ft: string) => {
          const c = FEATURE_MAP[ft];
          return c ? <Tag key={ft} color={c.color} style={{ fontSize: 11 }}>{c.label}</Tag> : ft;
        })}</Space>;
      },
    },
    ...(!isMobile ? [{
      title: '授权日期', dataIndex: 'auth_date', key: 'auth_date',
      render: (d: string) => d || '—',
    }] : []),
    {
      title: '截止日期', dataIndex: 'expiry_date', key: 'expiry_date',
      render: (d: string) => d || '—',
    },
    {
      title: '剩余', key: 'remaining',
      render: (_: any, r: any) => <RemainingTag remaining={r.remaining_days} method={r.method} />,
    },
    {
      title: '金额', dataIndex: 'amount', key: 'amount',
      render: (a: number) => a ? <span style={{ fontWeight: 600, color: '#fa8c16' }}>¥{a.toLocaleString()}</span> : '—',
    },
    {
      title: '操作', key: 'action',
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => handleViewDetail(r)}>详情</Button>
          <Button type="link" size="small" onClick={() => handleEdit(r.id)}>编辑</Button>
          {r.status === 'active' && (
            <Button type="link" size="small" onClick={() => {
              form.resetFields();
              setTenantOptions([]);
              setTenantSearch('');
              form.setFieldsValue({
                tenant_id: r.tenant_id,
                site_id: r.site_id,
                machine_id: r.machine_id,
                method: r.method,
                features: (() => { try { return JSON.parse(r.features || '[]'); } catch { return ['basic']; } })(),
              });
              setEditingId(null);
              setModalVisible(true);
            }}>续期</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: isMobile ? 0 : undefined }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Button type={activeTab === 'site' ? 'primary' : 'default'} icon={<KeyOutlined />}
          onClick={() => setActiveTab('site')}>授权管理（本站点）</Button>
        <Button type={activeTab === 'tenant' ? 'primary' : 'default'} icon={<BarChartOutlined />}
          onClick={() => setActiveTab('tenant')}>诊所授权管理</Button>
      </div>

      {activeTab === 'site' && (
        <Spin spinning={loading}>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: status === 'active' ? 'rgba(82,196,26,0.1)' :
                  status === 'expiring' ? 'rgba(250,140,22,0.1)' : 'rgba(255,77,79,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, color: status === 'active' ? '#52c41a' :
                  status === 'expiring' ? '#fa8c16' : '#ff4d4f',
              }}>
                {status === 'active' ? <SafetyCertificateOutlined /> :
                  status === 'expiring' ? <ExclamationCircleOutlined /> : <CloseCircleOutlined />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600,
                  color: status === 'active' ? '#389e0d' :
                    status === 'expiring' ? '#d46b08' : '#cf1322',
                }}>
                  {status === 'active' ? '已授权' :
                    status === 'expiring' ? '即将到期' :
                      status === 'expired' ? '已过期' : '未授权'}
                </div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                  {status === 'active' ? '软件授权有效，所有功能正常可用' :
                    status === 'expiring' ? '授权即将到期，请及时续期' :
                      status === 'expired' ? '授权已过期，部分功能可能受限' : '暂无授权信息'}
                </div>
              </div>
              <StatusTag status={status} remaining={remaining} />
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>站点标识</Text>
              <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>
                {siteID}{siteID && machineID ? ':' : ''}{machineID}
                {(siteID || machineID) && (
                  <CopyOutlined style={{ marginLeft: 6, cursor: 'pointer', color: '#52c41a' }}
                    onClick={() => copyToClipboard(`${siteID}:${machineID}`)} />
                )}
              </Text>
            </div>

            {license && status !== 'none' && (
              <div style={{ marginTop: 8, fontSize: 13, color: '#8B7355' }}>
                <ClockCircleOutlined style={{ marginRight: 4 }} />
                授权剩余 <Text strong style={{
                  fontSize: 18,
                  color: status === 'active' ? '#389e0d' : status === 'expiring' ? '#d46b08' : '#cf1322'
                }}>
                  {license.method === 'permanent' ? '∞' : remaining}
                </Text> 天
              </div>
            )}
          </Card>

          {license && (
            <Card title={<><SafetyCertificateOutlined style={{ color: '#52c41a', marginRight: 8 }} />授权详情（JWT 解码）</>}
              style={{ marginBottom: 16 }} size={isMobile ? 'small' : 'default'}>
              <Descriptions column={isMobile ? 2 : 3} size="small" bordered>
                <Descriptions.Item label="授权日期">{license.auth_date ? dayjs(license.auth_date).format('YYYY-MM-DD') : '—'}</Descriptions.Item>
                <Descriptions.Item label="截止日期">
                  {license.method === 'permanent' ? '永久' :
                    license.expiry_date ? dayjs(license.expiry_date).format('YYYY-MM-DD') : '—'}
                </Descriptions.Item>
                <Descriptions.Item label="授权方式">
                  {METHOD_MAP[license.method] ?
                    <Tag color={METHOD_MAP[license.method].color}>{METHOD_MAP[license.method].label}</Tag> : license.method}
                </Descriptions.Item>
                <Descriptions.Item label="付费金额">
                  <span style={{ color: '#fa8c16', fontWeight: 600 }}>¥{(license.amount || 0).toLocaleString()}</span>
                </Descriptions.Item>
                <Descriptions.Item label="授权功能">
                  <Space size={4}>
                    {(() => {
                      let f: string[] = [];
                      try { f = JSON.parse(license.features || '[]'); } catch { /* ignore */ }
                      return f.map((ft: string) => {
                        const c = FEATURE_MAP[ft];
                        return c ? <Tag key={ft} color={c.color}>{c.label}</Tag> : ft;
                      });
                    })()}
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="授权状态">
                  <StatusTag status={status} remaining={remaining} />
                </Descriptions.Item>
              </Descriptions>
            </Card>
          )}

          {decoded && (
            <Card title={<><KeyOutlined style={{ color: '#52c41a', marginRight: 8 }} />JWT 签名信息</>}
              style={{ marginBottom: 16 }} size={isMobile ? 'small' : 'default'}>
              <div style={{
                background: 'rgba(0,0,0,0.02)', border: '1px solid #f0f0f0',
                borderRadius: 8, padding: 12, fontFamily: 'monospace', fontSize: 12, lineHeight: 2,
              }}>
                <div><span style={{ color: '#999' }}>alg:</span> RS256</div>
                <div><span style={{ color: '#999' }}>typ:</span> JWT</div>
                <Divider style={{ margin: '4px 0', borderStyle: 'dashed' }} />
                <div><span style={{ color: '#999' }}>site_id:</span> {decoded.site_id}</div>
                <div><span style={{ color: '#999' }}>machine_id:</span> {decoded.machine_id}</div>
                <div><span style={{ color: '#999' }}>method:</span> {decoded.method}</div>
                <div><span style={{ color: '#999' }}>duration:</span> {decoded.duration}</div>
                <div><span style={{ color: '#999' }}>features:</span> {JSON.stringify(decoded.features)}</div>
                <div><span style={{ color: '#999' }}>amount:</span> {decoded.amount}</div>
                <div><span style={{ color: '#999' }}>iat:</span> {decoded.iat}</div>
                <div><span style={{ color: '#999' }}>exp:</span> {decoded.exp}</div>
              </div>
              <Alert type="info" style={{ marginTop: 8 }}
                message="此信息由公钥解码 JWT 数字签名获得，确保授权数据不可篡改" showIcon />
            </Card>
          )}

          <Card title={<><KeyOutlined style={{ color: '#fa8c16', marginRight: 8 }} />密钥信息</>}
            style={{ marginBottom: 16 }} size={isMobile ? 'small' : 'default'}>
            <Row gutter={isMobile ? 8 : 16}>
              <Col span={12}>
                <div style={{
                  background: keysData?.has_private ? 'rgba(82,196,26,0.04)' : 'rgba(255,77,79,0.04)',
                  border: `1px solid ${keysData?.has_private ? 'rgba(82,196,26,0.2)' : 'rgba(255,77,79,0.2)'}`,
                  borderRadius: 8, padding: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <KeyOutlined style={{ color: keysData?.has_private ? '#52c41a' : '#ff4d4f' }} />
                    <Text strong style={{ fontSize: 13 }}>私钥（本地）</Text>
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    {keysData?.has_private ? '已加载' : '未找到'}
                  </div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4, fontFamily: 'monospace' }}>
                    路径: {keysData?.private_key_path || 'scripts/private.pem'}
                  </div>
                </div>
              </Col>
              <Col span={12}>
                <div style={{
                  background: keysData?.public_key ? 'rgba(82,196,26,0.04)' : 'rgba(255,77,79,0.04)',
                  border: `1px solid ${keysData?.public_key ? 'rgba(82,196,26,0.2)' : 'rgba(255,77,79,0.2)'}`,
                  borderRadius: 8, padding: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <SafetyCertificateOutlined style={{ color: keysData?.public_key ? '#52c41a' : '#ff4d4f' }} />
                    <Text strong style={{ fontSize: 13 }}>公钥（GitHub）</Text>
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    {keysData?.public_key ? '已加载' : '未找到'}
                  </div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4, fontFamily: 'monospace' }}>
                    路径: {keysData?.public_key_path || 'scripts/public.pem'}
                  </div>
                  {keysData?.public_key && (
                    <Paragraph ellipsis={{ rows: 2 }} style={{
                      fontFamily: 'monospace', fontSize: 10, marginTop: 4, marginBottom: 0,
                      background: 'rgba(0,0,0,0.02)', padding: 4, borderRadius: 4,
                    }}>
                      {keysData.public_key}
                    </Paragraph>
                  )}
                </div>
              </Col>
            </Row>
          </Card>

          <Space>
            <Button type="primary" icon={<EditOutlined />} onClick={handleUpdateSiteLicense}>
              更新授权
            </Button>
            <Button icon={<ReloadOutlined />} onClick={fetchSiteData}>刷新状态</Button>
          </Space>
        </Spin>
      )}

      {activeTab === 'tenant' && (
        <>
          <Card title={<><BarChartOutlined style={{ color: '#52c41a', marginRight: 8 }} />付费统计</>}
            style={{ marginBottom: 16 }} size={isMobile ? 'small' : 'default'}
            extra={
              <RangePicker onChange={handleDateRangeChange} size="small"
                placeholder={['开始日期', '结束日期']} />
            }>
            {summary && (
              <Row gutter={isMobile ? 8 : 16} style={{ marginBottom: 16 }}>
                <Col span={6}><Statistic title="总收入" value={summary.total_amount} prefix="¥" precision={0} /></Col>
                <Col span={6}><Statistic title="授权数" value={summary.total_count} /></Col>
                <Col span={6}>
                  <Statistic title="基础功能" value={summary.by_feature?.basic || 0} prefix="¥" precision={0} />
                </Col>
                <Col span={6}>
                  <Statistic title="AI增值" value={summary.by_feature?.ai || 0} prefix="¥" precision={0} />
                </Col>
              </Row>
            )}
            <div style={{ height: isMobile ? 200 : 260 }}>
              <canvas ref={chartCanvasRef}></canvas>
            </div>
          </Card>

          <Card title="诊所授权列表" size={isMobile ? 'small' : 'default'}
            extra={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleCreate}>新增授权</Button>}>
            <Table dataSource={allLicenses} columns={columns} rowKey="id"
              size="small" scroll={isMobile ? { x: 700 } : undefined}
              pagination={{ pageSize: 10, size: 'small' }} />
          </Card>
        </>
      )}

      <Modal
        title={editingId ? '编辑授权' : '新增授权'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleSubmit}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" size="small">
          {!editingId && (
            <Form.Item name="tenant_id" label="诊所" rules={[{ required: true, message: '请选择诊所' }]}>
              <Select
                showSearch
                filterOption={false}
                onSearch={searchTenants}
                searchValue={tenantSearch}
                placeholder="输入诊所名称搜索"
                notFoundContent={tenantSearch ? '未找到诊所' : '请输入诊所名称搜索'}
              >
                {tenantOptions.map((t) => (
                  <Select.Option key={t.id} value={t.id}>
                    {t.name} ({t.code})
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="site_id" label="SITE_ID" rules={[{ required: true }]}>
                <Input placeholder="自动填充，失败可手动输入" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="machine_id" label="Machine ID" rules={[{ required: true }]}>
                <Input placeholder="自动填充，失败可手动输入" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="method" label="授权方式" rules={[{ required: true }]}>
                <Select>
                  <Select.Option value="day">按天</Select.Option>
                  <Select.Option value="week">按周</Select.Option>
                  <Select.Option value="month">按月</Select.Option>
                  <Select.Option value="year">按年</Select.Option>
                  <Select.Option value="permanent">永久</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="duration" label="授权数量">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="features" label="授权功能">
            <Checkbox.Group>
              <Checkbox value="basic">基础功能</Checkbox>
              <Checkbox value="ai">AI增值服务</Checkbox>
              <Checkbox value="cloud">云存储</Checkbox>
            </Checkbox.Group>
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="auth_date" label="授权日期">
                <Input placeholder="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="amount" label="付费金额（元）">
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="license_token" label="License 授权码（JWT）">
            <Input.TextArea rows={3} placeholder="粘贴 License JWT 授权码，或留空由系统自动签发" style={{ fontFamily: 'monospace', fontSize: 11 }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="可选" />
          </Form.Item>
          <Divider titlePlacement="left" style={{ fontSize: 12 }}>密钥信息</Divider>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label={<><KeyOutlined style={{ color: '#fa8c16' }} /> 私钥</>}>
                <div style={{
                  background: keysData?.has_private ? 'rgba(82,196,26,0.04)' : 'rgba(255,77,79,0.04)',
                  border: `1px solid ${keysData?.has_private ? 'rgba(82,196,26,0.2)' : 'rgba(255,77,79,0.2)'}`,
                  borderRadius: 6, padding: 6, fontSize: 11,
                }}>
                  {keysData?.has_private ? '已加载' : '未找到'}
                  <div style={{ color: '#999', fontFamily: 'monospace', fontSize: 10, marginTop: 2 }}>
                    {keysData?.private_key_path || 'scripts/private.pem'}
                  </div>
                </div>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<><SafetyCertificateOutlined style={{ color: '#52c41a' }} /> 公钥</>}>
                <div style={{
                  background: keysData?.public_key ? 'rgba(82,196,26,0.04)' : 'rgba(255,77,79,0.04)',
                  border: `1px solid ${keysData?.public_key ? 'rgba(82,196,26,0.2)' : 'rgba(255,77,79,0.2)'}`,
                  borderRadius: 6, padding: 6, fontSize: 11,
                }}>
                  {keysData?.public_key ? '已加载' : '未找到'}
                  <div style={{ color: '#999', fontFamily: 'monospace', fontSize: 10, marginTop: 2 }}>
                    {keysData?.public_key_path || 'scripts/public.pem'}
                  </div>
                </div>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Drawer
        title={<><HistoryOutlined style={{ color: '#52c41a', marginRight: 8 }} />授权详情</>}
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        width={isMobile ? '100%' : 560}
        destroyOnClose
      >
        {detailData && (
          <>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="授权日期" span={1}>
                {detailData.license?.auth_date ? dayjs(detailData.license.auth_date).format('YYYY-MM-DD') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="截止日期" span={1}>
                {detailData.license?.method === 'permanent' ? '永久' :
                  detailData.license?.expiry_date ? dayjs(detailData.license.expiry_date).format('YYYY-MM-DD') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="授权方式" span={1}>
                {METHOD_MAP[detailData.license?.method] ?
                  <Tag color={METHOD_MAP[detailData.license.method].color}>{METHOD_MAP[detailData.license.method].label}</Tag> : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="付费金额" span={1}>
                <span style={{ color: '#fa8c16', fontWeight: 600 }}>¥{(detailData.license?.amount || 0).toLocaleString()}</span>
              </Descriptions.Item>
              <Descriptions.Item label="授权功能" span={2}>
                <Space size={4}>
                  {(() => {
                    let f: string[] = [];
                    try { f = JSON.parse(detailData.license?.features || '[]'); } catch { /* ignore */ }
                    return f.map((ft: string) => {
                      const c = FEATURE_MAP[ft];
                      return c ? <Tag key={ft} color={c.color}>{c.label}</Tag> : ft;
                    });
                  })()}
                </Space>
              </Descriptions.Item>
            </Descriptions>

            <Card title="授权历史" size="small">
              <Timeline
                items={detailHistory.map((lic: any) => ({
                  color: lic.status === 'active' ? 'green' : 'gray',
                  children: (
                    <div style={{
                      background: lic.status === 'active' ? 'rgba(82,196,26,0.03)' : 'rgba(0,0,0,0.02)',
                      border: `1px solid ${lic.status === 'active' ? 'rgba(82,196,26,0.2)' : '#f0f0f0'}`,
                      borderRadius: 8, padding: 10,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text strong style={{ fontSize: 13 }}>
                          {lic.auth_date ? dayjs(lic.auth_date).format('YYYY-MM-DD') : '—'} ~ {lic.method === 'permanent' ? '永久' :
                            lic.expiry_date ? dayjs(lic.expiry_date).format('YYYY-MM-DD') : '—'}
                        </Text>
                        <StatusTag status={lic.status} remaining={0} />
                      </div>
                      <div style={{ fontSize: 11, color: '#999', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <span>{METHOD_MAP[lic.method] ? <Tag color={METHOD_MAP[lic.method].color} style={{ fontSize: 10 }}>{METHOD_MAP[lic.method].label}</Tag> : lic.method}</span>
                        <span>¥{(lic.amount || 0).toLocaleString()}</span>
                        <span>{lic.created_by}</span>
                      </div>
                    </div>
                  ),
                }))}
              />
            </Card>
          </>
        )}
      </Drawer>
    </div>
  );
}
