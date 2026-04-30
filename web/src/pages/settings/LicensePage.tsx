import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, Select, InputNumber,
  Tag, Space, Statistic, Row, Col, DatePicker, message, Spin,
  Descriptions, Timeline, Divider, Alert, Checkbox, Typography, Drawer, Popconfirm
} from 'antd';
import {
  KeyOutlined, SafetyCertificateOutlined, ClockCircleOutlined,
  PlusOutlined, CopyOutlined, ReloadOutlined, EditOutlined,
  CheckCircleOutlined, ExclamationCircleOutlined, CloseCircleOutlined,
  BarChartOutlined, HistoryOutlined, LockOutlined, DeleteOutlined
} from '@ant-design/icons';
import {
  getSiteLicense, listAllLicenses, createLicense, updateLicense,
  getLicense, getLicenseStats, getKeys,
  listTenantLicenses, verifyLicenseToken, deleteLicense
} from '../../api/license';
import useIsMobile from '../../hooks/useIsMobile';
import { useAuth } from '../../store/auth';
import dayjs from 'dayjs';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import Chart from 'chart.js/auto';

dayjs.extend(weekOfYear);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const CNSH = 'Asia/Shanghai';
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

type QuickRange = 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear' | '';

function getQuickRange(range: QuickRange): [dayjs.Dayjs, dayjs.Dayjs] {
  const now = dayjs();
  switch (range) {
    case 'thisWeek': return [now.startOf('week'), now.endOf('week')];
    case 'lastWeek': return [now.subtract(1, 'week').startOf('week'), now.subtract(1, 'week').endOf('week')];
    case 'thisMonth': return [now.startOf('month'), now.endOf('month')];
    case 'lastMonth': return [now.subtract(1, 'month').startOf('month'), now.subtract(1, 'month').endOf('month')];
    case 'thisYear': return [now.startOf('year'), now.endOf('year')];
    case 'lastYear': return [now.subtract(1, 'year').startOf('year'), now.subtract(1, 'year').endOf('year')];
    default: return [now.startOf('year'), now.endOf('year')];
  }
}

function fmtCST(d: string | undefined | null): string {
  if (!d) return '—';
  const parsed = dayjs(d).tz(CNSH);
  if (!parsed.isValid()) return '—';
  return parsed.format('YYYY/MM/DD HH:mm:ss');
}

function parseCST(d: string): dayjs.Dayjs {
  if (!d) return dayjs().tz(CNSH);
  const parsed = dayjs(d).tz(CNSH);
  if (!parsed.isValid()) return dayjs().tz(CNSH);
  return parsed;
}

function parseDateCST(d: string): dayjs.Dayjs {
  if (!d) return dayjs().tz(CNSH);
  const parsed = dayjs.tz(d, 'YYYY-MM-DD', CNSH);
  if (!parsed.isValid()) return dayjs().tz(CNSH);
  return parsed;
}

function calcExpiry(authDate: string, method: string, duration: number): string {
  if (method === 'permanent') return '永久';
  if (!authDate) return '—';
  const start = parseDateCST(authDate);
  if (!start.isValid()) return '—';
  let expiry: dayjs.Dayjs;
  switch (method) {
    case 'day': expiry = start.add(duration, 'day'); break;
    case 'week': expiry = start.add(duration * 7, 'day'); break;
    case 'month': expiry = start.add(duration, 'month'); break;
    case 'year': expiry = start.add(duration, 'year'); break;
    default: expiry = start.add(duration, 'month');
  }
  return expiry.hour(23).minute(59).second(59).format('YYYY/MM/DD HH:mm:ss');
}

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

function fallbackCopy(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* ignore */ }
  document.body.removeChild(ta);
}

function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => message.success('已复制')).catch(() => { fallbackCopy(text); message.success('已复制'); });
  } else {
    fallbackCopy(text);
    message.success('已复制');
  }
}

export default function LicensePage() {
  const isMobile = useIsMobile();
  const { checkLicenseStatus } = useAuth();
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
  const [updateModalVisible, setUpdateModalVisible] = useState(false);
  const [updateToken, setUpdateToken] = useState('');
  const [updateDecoded, setUpdateDecoded] = useState<any>(null);
  const [updateVerifying, setUpdateVerifying] = useState(false);
  const [activeQuickRange, setActiveQuickRange] = useState<QuickRange>('thisYear');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [currentLicenseToken, setCurrentLicenseToken] = useState('');
  const [chartReady, setChartReady] = useState(false);
  const [previewExpiry, setPreviewExpiry] = useState('');
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  const fetchSiteData = useCallback(async () => {
    setLoading(true);
    try { const res: any = await getSiteLicense(); setSiteData(res.data); } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const fetchAllLicenses = useCallback(async (search?: string) => {
    try {
      const res: any = await listAllLicenses(search);
      setAllLicenses(Array.isArray(res.data) ? res.data : []);
    } catch { /* ignore */ }
  }, []);

  const fetchStats = useCallback(async (start?: string, end?: string) => {
    try { const res: any = await getLicenseStats(start, end); setStats(res.data); } catch { /* ignore */ }
  }, []);

  const fetchKeys = useCallback(async () => {
    try { const res: any = await getKeys(); setKeysData(res.data); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const [s, e] = getQuickRange('thisYear');
    fetchSiteData(); fetchAllLicenses(); fetchStats(s.format('YYYY-MM-DD'), e.format('YYYY-MM-DD')); fetchKeys();
  }, [fetchSiteData, fetchAllLicenses, fetchStats, fetchKeys]);

  useEffect(() => {
    if (activeTab === 'tenant') { setTimeout(() => setChartReady(true), 50); }
    else { setChartReady(false); }
  }, [activeTab]);

  useEffect(() => {
    if (!chartReady || !stats?.monthly || !chartCanvasRef.current) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();
    const ctx = chartCanvasRef.current.getContext('2d');
    if (!ctx) return;
    const monthly = Array.isArray(stats.monthly) ? stats.monthly : [];
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
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 12 } } },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { callback: (v: any) => '¥' + v.toLocaleString() } }
        }
      }
    });
  }, [chartReady, stats]);

  const updatePreviewExpiry = useCallback(() => {
    const method = form.getFieldValue('method');
    const duration = form.getFieldValue('duration');
    const authDate = form.getFieldValue('auth_date');
    if (method && duration && authDate) {
      setPreviewExpiry(calcExpiry(authDate, method, duration));
    } else {
      setPreviewExpiry('');
    }
  }, [form]);

  const handleCreate = () => {
    setEditingId(null);
    setCurrentLicenseToken('');
    setPreviewExpiry('');
    form.resetFields();
    form.setFieldsValue({
      method: 'month', duration: 1, features: ['basic'], amount: 0,
      auth_date: dayjs().tz(CNSH).format('YYYY-MM-DD'),
      site_id: siteData?.site_id || '',
      machine_id: siteData?.machine_id || '',
    });
    setPreviewExpiry(calcExpiry(dayjs().tz(CNSH).format('YYYY-MM-DD'), 'month', 1));
    setModalVisible(true);
  };

  const handleUpdateSiteLicense = () => {
    setUpdateToken(''); setUpdateDecoded(null); setUpdateModalVisible(true);
  };

  const handleVerifyAndUpdate = async () => {
    if (!updateToken.trim()) { message.error('请输入License授权码'); return; }
    setUpdateVerifying(true);
    try {
      const res: any = await verifyLicenseToken(updateToken.trim());
      const data = res.data;
      setUpdateDecoded(data);
      if (data?.mismatches?.length > 0) {
        message.warning('License站点标识不匹配: ' + data.mismatches.join('; '));
      }
    } catch (e: any) { message.error(e?.response?.data?.message || 'License验证失败'); }
    setUpdateVerifying(false);
  };

  const handleConfirmUpdate = async () => {
    if (updateDecoded?.mismatches?.length > 0) {
      message.error('站点标识不匹配，无法应用: ' + updateDecoded.mismatches.join('; '));
      return;
    }
    try {
      let targetId = siteData?.license?.id;
      if (!targetId) {
        const matched = allLicenses.find((lic: any) =>
          lic.site_id === siteID && lic.machine_id === machineID
        );
        targetId = matched?.id;
      }

      if (targetId) {
        await updateLicense(targetId, { license_token: updateToken.trim() });
        message.success('授权已更新');
      } else {
        await createLicense({
          site_id: siteID, machine_id: machineID,
          method: updateDecoded?.claims?.method || 'month', duration: updateDecoded?.claims?.duration || 1,
          features: updateDecoded?.claims?.features || ['basic'], amount: updateDecoded?.claims?.amount || 0,
          license_token: updateToken.trim(),
        });
        message.success('授权已签发');
      }
      setUpdateModalVisible(false);
      message.destroy('license_expired');
      await fetchSiteData();
      fetchAllLicenses(searchKeyword);
      fetchStats();
      await checkLicenseStatus();
    } catch (e: any) { message.error(e?.response?.data?.message || '操作失败'); }
  };

  const handleEdit = async (id: number) => {
    try {
      const res: any = await getLicense(id);
      const lic = res.data?.license;
      if (lic) {
        setEditingId(id);
        setCurrentLicenseToken(lic.jwt_token || '');
        let features: string[] = [];
        try { features = JSON.parse(lic.features || '[]'); } catch { /* ignore */ }
        form.setFieldsValue({
          site_id: lic.site_id, machine_id: lic.machine_id,
          method: lic.method, duration: lic.duration || 1,
          auth_date: lic.auth_date ? parseCST(lic.auth_date).format('YYYY-MM-DD') : undefined,
          features, amount: lic.amount, remark: lic.remark,
        });
        if (lic.auth_date && lic.method) {
          setPreviewExpiry(calcExpiry(parseCST(lic.auth_date).format('YYYY-MM-DD'), lic.method, lic.duration || 1));
        }
        setModalVisible(true);
      }
    } catch { message.error('获取授权详情失败'); }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteLicense(id);
      message.success('已删除');
      await fetchSiteData();
      fetchAllLicenses(searchKeyword);
      fetchStats();
      await checkLicenseStatus();
    } catch { message.error('删除失败'); }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (!editingId && !keysData?.has_private) {
        message.error('私钥未加载，无法签发License。请确保服务器上存在私钥文件。');
        return;
      }
      const payload = { ...values };
      delete (payload as any).license_token;
      if (editingId) { await updateLicense(editingId, payload); message.success('授权已更新'); }
      else { await createLicense(payload); message.success('授权已签发'); }
      setModalVisible(false);
      message.destroy('license_expired');
      await fetchSiteData();
      fetchAllLicenses(searchKeyword);
      fetchStats();
      await checkLicenseStatus();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e?.response?.data?.message || '操作失败');
    }
  };

  const handleViewDetail = async (record: any) => {
    try {
      const res: any = await getLicense(record.id);
      setDetailData(res.data);
      if (record.tenant_id) {
        const histRes: any = await listTenantLicenses(record.tenant_id);
        setDetailHistory(Array.isArray(histRes.data) ? histRes.data : []);
      } else { setDetailHistory([]); }
      setDetailVisible(true);
    } catch { message.error('获取详情失败'); }
  };

  const handleQuickRange = (range: QuickRange) => {
    setActiveQuickRange(range);
    const [s, e] = getQuickRange(range);
    fetchStats(s.format('YYYY-MM-DD'), e.format('YYYY-MM-DD'));
  };

  const handleDateRangeChange = (dates: any) => {
    setActiveQuickRange('');
    if (dates && dates[0] && dates[1]) { fetchStats(dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')); }
    else { fetchStats(); }
  };

  const handleSearch = (value: string) => { setSearchKeyword(value); fetchAllLicenses(value); };

  const handleSiteKeyInput = (value: string) => {
    if (value.includes(':')) {
      const idx = value.indexOf(':');
      form.setFieldsValue({ site_id: value.substring(0, idx).trim(), machine_id: value.substring(idx + 1).trim() });
    }
  };

  const siteID = siteData?.site_id || '';
  const machineID = siteData?.machine_id || '';
  const license = siteData?.license;
  const status = siteData?.status || 'none';
  const remaining = siteData?.remaining_days || 0;
  const decoded = siteData?.decoded_claims;
  const summary = stats?.summary;
  const isExpiredOrNone = status === 'expired' || status === 'none';
  const monthlyCount = Array.isArray(stats?.monthly) ? stats.monthly.length : 0;

  const quickRangeButtons: { key: QuickRange; label: string }[] = [
    { key: 'thisWeek', label: '本周' }, { key: 'lastWeek', label: '上周' },
    { key: 'thisMonth', label: '本月' }, { key: 'lastMonth', label: '上月' },
    { key: 'thisYear', label: '本年' }, { key: 'lastYear', label: '上年' },
  ];

  const columns = [
    {
      title: '诊所', dataIndex: 'tenant_name', key: 'tenant_name', width: 160,
      render: (name: string, r: any) => (
        <div>
          <div style={{ fontWeight: 500 }}>{r.site_id ? <span style={{ color: '#722ed1', marginRight: 4 }}>{r.site_id}:</span> : ''}{name || '—'}</div>
          <div style={{ fontSize: 11, color: '#999' }}>{r.tenant_code || ''}</div>
        </div>
      ),
    },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (s: string) => <StatusTag status={s} remaining={0} /> },
    {
      title: '方式', dataIndex: 'method', key: 'method', width: 70,
      render: (m: string) => { const c = METHOD_MAP[m]; return c ? <Tag color={c.color}>{c.label}</Tag> : m; },
    },
    {
      title: '有效期', key: 'period', width: 280,
      render: (_: any, r: any) => (
        <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {fmtCST(r.auth_date)} ~ {r.method === 'permanent' ? '永久' : fmtCST(r.expiry_date)}
        </span>
      ),
    },
    { title: '剩余', key: 'remaining', width: 60, render: (_: any, r: any) => <RemainingTag remaining={r.remaining_days} method={r.method} /> },
    {
      title: '金额', dataIndex: 'amount', key: 'amount', width: 80,
      render: (a: number) => a ? <span style={{ fontWeight: 600, color: '#fa8c16' }}>¥{a.toLocaleString()}</span> : '—',
    },
    {
      title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true,
      width: 120, render: (r: string) => r ? <Text ellipsis style={{ maxWidth: 120 }}>{r}</Text> : '—',
    },
    {
      title: '操作', key: 'action', width: 160, fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => handleViewDetail(r)}>详情</Button>
          <Button type="link" size="small" onClick={() => handleEdit(r.id)}>编辑</Button>
          <Popconfirm title="确认删除此授权记录？" onConfirm={() => handleDelete(r.id)} okText="删除" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: isMobile ? 0 : undefined, maxWidth: '100%', overflowX: 'hidden' }}>
      {isExpiredOrNone && (
        <Alert type="error" showIcon icon={<LockOutlined />} style={{ marginBottom: 16 }}
          message="软件授权已过期，请联系管理员"
          description="系统当前未授权或授权已过期，除授权管理外的所有功能已被锁定。请联系管理员进行授权续期。" />
      )}

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
                width: isMobile ? 36 : 48, height: isMobile ? 36 : 48, borderRadius: 12,
                background: status === 'active' ? 'rgba(82,196,26,0.1)' : status === 'expiring' ? 'rgba(250,140,22,0.1)' : 'rgba(255,77,79,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: isMobile ? 18 : 22,
                color: status === 'active' ? '#52c41a' : status === 'expiring' ? '#fa8c16' : '#ff4d4f',
              }}>
                {status === 'active' ? <SafetyCertificateOutlined /> : status === 'expiring' ? <ExclamationCircleOutlined /> : <CloseCircleOutlined />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 600,
                  color: status === 'active' ? '#389e0d' : status === 'expiring' ? '#d46b08' : '#cf1322',
                }}>
                  {status === 'active' ? '已授权' : status === 'expiring' ? '即将到期' : status === 'expired' ? '已过期' : '未授权'}
                </div>
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                  {status === 'active' ? '软件授权有效，所有功能正常可用' : status === 'expiring' ? '授权即将到期，请及时续期' : status === 'expired' ? '授权已过期，部分功能可能受限' : '暂无授权信息'}
                </div>
              </div>
              <StatusTag status={status} remaining={remaining} />
            </div>
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>站点标识</Text>
              <Text code style={{ fontSize: isMobile ? 10 : 12, wordBreak: 'break-all' }}>
                {siteID}{siteID && machineID ? ':' : ''}{machineID}
                {(siteID || machineID) && <CopyOutlined style={{ marginLeft: 6, cursor: 'pointer', color: '#52c41a' }} onClick={() => copyText(`${siteID}:${machineID}`)} />}
              </Text>
            </div>
            {license && status !== 'none' && (
              <div style={{ marginTop: 8, fontSize: 13, color: '#8B7355' }}>
                <ClockCircleOutlined style={{ marginRight: 4 }} />
                授权剩余 <Text strong style={{ fontSize: 18, color: status === 'active' ? '#389e0d' : status === 'expiring' ? '#d46b08' : '#cf1322' }}>
                  {license.method === 'permanent' ? '∞' : remaining}
                </Text> 天
              </div>
            )}
          </Card>

          {license && (
            <Card title={<><SafetyCertificateOutlined style={{ color: '#52c41a', marginRight: 8 }} />授权详情（JWT 解码）</>}
              style={{ marginBottom: 16 }} size={isMobile ? 'small' : 'default'}>
              <Descriptions column={isMobile ? 1 : 3} size="small" bordered>
                <Descriptions.Item label="SITE_ID">{license.site_id || '—'}</Descriptions.Item>
                <Descriptions.Item label="Machine ID">{license.machine_id || '—'}</Descriptions.Item>
                <Descriptions.Item label="授权时长">
                  {license.method === 'permanent' ? <Tag color="cyan">永久</Tag> :
                    `${license.duration || 1}${METHOD_MAP[license.method]?.label?.replace('按', '') || license.method}`}
                </Descriptions.Item>
                <Descriptions.Item label="授权日期">{fmtCST(license.auth_date)}</Descriptions.Item>
                <Descriptions.Item label="截止日期">{license.method === 'permanent' ? '永久' : fmtCST(license.expiry_date)}</Descriptions.Item>
                <Descriptions.Item label="授权方式">{METHOD_MAP[license.method] ? <Tag color={METHOD_MAP[license.method].color}>{METHOD_MAP[license.method].label}</Tag> : license.method}</Descriptions.Item>
                <Descriptions.Item label="付费金额"><span style={{ color: '#fa8c16', fontWeight: 600 }}>¥{(license.amount || 0).toLocaleString()}</span></Descriptions.Item>
                <Descriptions.Item label="授权功能">
                  <Space size={4}>{(() => { let f: string[] = []; try { f = JSON.parse(license.features || '[]'); } catch { /* ignore */ } return f.map((ft: string) => { const c = FEATURE_MAP[ft]; return c ? <Tag key={ft} color={c.color}>{c.label}</Tag> : ft; }); })()}</Space>
                </Descriptions.Item>
                <Descriptions.Item label="授权状态"><StatusTag status={status} remaining={remaining} /></Descriptions.Item>
              </Descriptions>
            </Card>
          )}

          {decoded && (
            <Card title={<><KeyOutlined style={{ color: '#52c41a', marginRight: 8 }} />JWT 签名信息</>}
              style={{ marginBottom: 16 }} size={isMobile ? 'small' : 'default'}>
              <div style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, fontFamily: 'monospace', fontSize: 12, lineHeight: 2, overflowX: 'auto' }}>
                <div><span style={{ color: '#999' }}>alg:</span> RS256</div>
                <div><span style={{ color: '#999' }}>typ:</span> JWT</div>
                <Divider style={{ margin: '4px 0', borderStyle: 'dashed' }} />
                <div><span style={{ color: '#999' }}>site_id:</span> {decoded.site_id}</div>
                <div><span style={{ color: '#999' }}>machine_id:</span> {decoded.machine_id}</div>
                <div><span style={{ color: '#999' }}>method:</span> {decoded.method}</div>
                <div><span style={{ color: '#999' }}>duration:</span> {decoded.duration}</div>
                <div><span style={{ color: '#999' }}>授权时长:</span> {license.method === 'permanent' ? '永久' : `${license.duration || 1}${METHOD_MAP[license.method]?.label?.replace('按', '') || license.method}`}</div>
                <div><span style={{ color: '#999' }}>features:</span> {JSON.stringify(decoded.features)}</div>
                <div><span style={{ color: '#999' }}>amount:</span> {decoded.amount}</div>
                <div><span style={{ color: '#999' }}>iat:</span> {decoded.iat}</div>
                <div><span style={{ color: '#999' }}>exp:</span> {decoded.exp}</div>
              </div>
              <Alert type="info" style={{ marginTop: 8 }} message="此信息由公钥解码 JWT 数字签名获得，确保授权数据不可篡改" showIcon />
            </Card>
          )}

          <Card title={<><KeyOutlined style={{ color: '#fa8c16', marginRight: 8 }} />密钥信息</>}
            style={{ marginBottom: 16 }} size={isMobile ? 'small' : 'default'}>
            <Row gutter={isMobile ? 8 : 16}>
              <Col span={12}>
                <div style={{ background: keysData?.has_private ? 'rgba(82,196,26,0.04)' : 'rgba(255,77,79,0.04)', border: `1px solid ${keysData?.has_private ? 'rgba(82,196,26,0.2)' : 'rgba(255,77,79,0.2)'}`, borderRadius: 8, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <KeyOutlined style={{ color: keysData?.has_private ? '#52c41a' : '#ff4d4f' }} />
                    <Text strong style={{ fontSize: 13 }}>私钥（本地）</Text>
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>{keysData?.has_private ? '已加载' : '未找到'}</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4, fontFamily: 'monospace' }}>路径: {keysData?.private_key_path || 'scripts/private.pem'}</div>
                </div>
              </Col>
              <Col span={12}>
                <div style={{ background: keysData?.public_key ? 'rgba(82,196,26,0.04)' : 'rgba(255,77,79,0.04)', border: `1px solid ${keysData?.public_key ? 'rgba(82,196,26,0.2)' : 'rgba(255,77,79,0.2)'}`, borderRadius: 8, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <SafetyCertificateOutlined style={{ color: keysData?.public_key ? '#52c41a' : '#ff4d4f' }} />
                    <Text strong style={{ fontSize: 13 }}>公钥（GitHub）</Text>
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>{keysData?.public_key ? '已加载' : '未找到'}</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4, fontFamily: 'monospace' }}>路径: {keysData?.public_key_path || 'scripts/public.pem'}</div>
                  {keysData?.public_key && <Paragraph ellipsis={{ rows: 2 }} style={{ fontFamily: 'monospace', fontSize: 10, marginTop: 4, marginBottom: 0, background: 'rgba(0,0,0,0.02)', padding: 4, borderRadius: 4 }}>{keysData.public_key}</Paragraph>}
                </div>
              </Col>
            </Row>
          </Card>

          <Space>
            <Button type="primary" icon={<EditOutlined />} onClick={handleUpdateSiteLicense}>更新授权</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchSiteData}>刷新状态</Button>
          </Space>
        </Spin>
      )}

      {activeTab === 'tenant' && (
        <>
          <Card title={<><BarChartOutlined style={{ color: '#52c41a', marginRight: 8 }} />付费统计</>}
            style={{ marginBottom: 16 }} size={isMobile ? 'small' : 'default'}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, alignItems: 'center' }}>
              {quickRangeButtons.map(q => (
                <Button key={q.key} size="small" type={activeQuickRange === q.key ? 'primary' : 'default'} onClick={() => handleQuickRange(q.key)}>{q.label}</Button>
              ))}
              <RangePicker onChange={handleDateRangeChange} size="small" placeholder={['自定义', '范围']} style={{ marginLeft: 4 }} />
            </div>
            {summary && (
              <Row gutter={isMobile ? 8 : 16} style={{ marginBottom: 16 }}>
                <Col span={6}><Statistic title="总收入" value={summary.total_amount} prefix="¥" precision={0} /></Col>
                <Col span={6}><Statistic title="授权数" value={summary.total_count} /></Col>
                <Col span={6}><Statistic title="基础功能" value={summary.by_feature?.basic || 0} prefix="¥" precision={0} /></Col>
                <Col span={6}><Statistic title="AI增值" value={summary.by_feature?.ai || 0} prefix="¥" precision={0} /></Col>
              </Row>
            )}
            <div style={{
              height: isMobile ? 240 : 320,
              width: '100%',
              maxWidth: monthlyCount <= 1 ? 320 : monthlyCount <= 3 ? Math.max(320, monthlyCount * 180) : 800,
              margin: '0 auto',
            }}>
              <canvas ref={chartCanvasRef}></canvas>
            </div>
          </Card>

          <Card title="授权列表" size={isMobile ? 'small' : 'default'}
            extra={
              <Space>
                <Input.Search placeholder="搜索诊所/站点" allowClear size="small" style={{ width: isMobile ? 120 : 200 }}
                  onSearch={handleSearch} onChange={e => { if (!e.target.value) handleSearch(''); }} />
                <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleCreate}>新增授权</Button>
              </Space>
            }>
            <Table dataSource={allLicenses} columns={columns} rowKey="id"
              size="small" scroll={isMobile ? { x: 900 } : undefined}
              pagination={{ pageSize: 20, size: 'small', showSizeChanger: true, pageSizeOptions: ['10', '20', '50'] }} />
          </Card>
        </>
      )}

      <Modal title={editingId ? '编辑授权' : '新增授权'} open={modalVisible} onCancel={() => setModalVisible(false)}
        onOk={handleSubmit} okText="生成授权" width={560} destroyOnClose>
        <Form form={form} layout="vertical" size="small">
          {editingId && currentLicenseToken && (
            <Form.Item label="当前 License">
              <Input.TextArea rows={3} value={currentLicenseToken} readOnly
                style={{ fontFamily: 'monospace', fontSize: 11, background: 'rgba(0,0,0,0.02)', color: '#666' }} />
              <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(currentLicenseToken)} style={{ marginTop: 4 }}>复制 License</Button>
            </Form.Item>
          )}
          <Form.Item label="站点标识（输入组合key自动拆解，如 xyj:kL0Wxn_2026-04-29 17:55:46）">
            <Input placeholder="输入 SITE_ID:Machine_ID 自动拆解" onChange={e => handleSiteKeyInput(e.target.value)} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="site_id" label="SITE_ID" rules={[{ required: true }]}>
                <Input placeholder="站点标识" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="machine_id" label="Machine ID" rules={[{ required: true }]}>
                <Input placeholder="机器标识" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="method" label="授权方式" rules={[{ required: true }]}>
                <Select onChange={() => updatePreviewExpiry()}>
                  <Select.Option value="day">按天</Select.Option>
                  <Select.Option value="week">按周</Select.Option>
                  <Select.Option value="month">按月</Select.Option>
                  <Select.Option value="year">按年</Select.Option>
                  <Select.Option value="permanent">永久</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="duration" label="授权数量">
                <InputNumber min={1} style={{ width: '100%' }} onChange={() => updatePreviewExpiry()} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="auth_date" label="授权日期">
                <Input placeholder="YYYY-MM-DD" onChange={() => updatePreviewExpiry()} />
              </Form.Item>
            </Col>
          </Row>
          {previewExpiry && (
            <Alert type="info" style={{ marginBottom: 12 }} showIcon icon={<ClockCircleOutlined />}
              message={`预计截止日期: ${previewExpiry} (北京时间)`} />
          )}
          <Form.Item name="features" label="授权功能">
            <Checkbox.Group>
              <Checkbox value="basic">基础功能</Checkbox>
              <Checkbox value="ai">AI增值服务</Checkbox>
              <Checkbox value="cloud">云存储</Checkbox>
            </Checkbox.Group>
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="amount" label="付费金额（元）">
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="remark" label="备注">
                <Input placeholder="可选" />
              </Form.Item>
            </Col>
          </Row>
          <Divider titlePlacement="left" style={{ fontSize: 12 }}>密钥信息</Divider>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label={<><KeyOutlined style={{ color: '#fa8c16' }} /> 私钥</>}>
                <div style={{ background: keysData?.has_private ? 'rgba(82,196,26,0.04)' : 'rgba(255,77,79,0.04)', border: `1px solid ${keysData?.has_private ? 'rgba(82,196,26,0.2)' : 'rgba(255,77,79,0.2)'}`, borderRadius: 6, padding: 6, fontSize: 11 }}>
                  {keysData?.has_private ? '已加载' : '未找到'}
                  <div style={{ color: '#999', fontFamily: 'monospace', fontSize: 10, marginTop: 2 }}>{keysData?.private_key_path || 'scripts/private.pem'}</div>
                </div>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<><SafetyCertificateOutlined style={{ color: '#52c41a' }} /> 公钥</>}>
                <div style={{ background: keysData?.public_key ? 'rgba(82,196,26,0.04)' : 'rgba(255,77,79,0.04)', border: `1px solid ${keysData?.public_key ? 'rgba(82,196,26,0.2)' : 'rgba(255,77,79,0.2)'}`, borderRadius: 6, padding: 6, fontSize: 11 }}>
                  {keysData?.public_key ? '已加载' : '未找到'}
                  <div style={{ color: '#999', fontFamily: 'monospace', fontSize: 10, marginTop: 2 }}>{keysData?.public_key_path || 'scripts/public.pem'}</div>
                </div>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Drawer title={<><HistoryOutlined style={{ color: '#52c41a', marginRight: 8 }} />授权详情</>}
        open={detailVisible} onClose={() => setDetailVisible(false)} width={isMobile ? '100%' : 560} destroyOnClose>
        {detailData && (
          <>
            {detailData.license?.jwt_token && (
              <Card size="small" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text strong style={{ fontSize: 12 }}>License</Text>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(detailData.license.jwt_token)}>复制</Button>
                </div>
                <Paragraph ellipsis={{ rows: 3 }} style={{ fontFamily: 'monospace', fontSize: 10, marginBottom: 0, background: 'rgba(0,0,0,0.02)', padding: 8, borderRadius: 4, wordBreak: 'break-all' }}>
                  {detailData.license.jwt_token}
                </Paragraph>
              </Card>
            )}
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="SITE_ID" span={1}>{detailData.license?.site_id || '—'}</Descriptions.Item>
              <Descriptions.Item label="Machine ID" span={1}>{detailData.license?.machine_id || '—'}</Descriptions.Item>
              <Descriptions.Item label="授权时长" span={1}>
                {detailData.license?.method === 'permanent' ? <Tag color="cyan">永久</Tag> :
                  `${detailData.license?.duration || 1}${METHOD_MAP[detailData.license?.method]?.label?.replace('按', '') || ''}`}
              </Descriptions.Item>
              <Descriptions.Item label="授权方式" span={1}>{METHOD_MAP[detailData.license?.method] ? <Tag color={METHOD_MAP[detailData.license.method].color}>{METHOD_MAP[detailData.license.method].label}</Tag> : '—'}</Descriptions.Item>
              <Descriptions.Item label="授权日期" span={1}>{fmtCST(detailData.license?.auth_date)}</Descriptions.Item>
              <Descriptions.Item label="截止日期" span={1}>{detailData.license?.method === 'permanent' ? '永久' : fmtCST(detailData.license?.expiry_date)}</Descriptions.Item>
              <Descriptions.Item label="付费金额" span={1}><span style={{ color: '#fa8c16', fontWeight: 600 }}>¥{(detailData.license?.amount || 0).toLocaleString()}</span></Descriptions.Item>
              <Descriptions.Item label="授权功能" span={1}>
                <Space size={4}>{(() => { let f: string[] = []; try { f = JSON.parse(detailData.license?.features || '[]'); } catch { /* ignore */ } return f.map((ft: string) => { const c = FEATURE_MAP[ft]; return c ? <Tag key={ft} color={c.color}>{c.label}</Tag> : ft; }); })()}</Space>
              </Descriptions.Item>
            </Descriptions>
            {detailHistory.length > 0 && (
              <Card title="授权历史" size="small">
                <Timeline items={detailHistory.map((lic: any) => ({
                  color: lic.status === 'active' ? 'green' : 'gray',
                  children: (
                    <div style={{ background: lic.status === 'active' ? 'rgba(82,196,26,0.03)' : 'rgba(0,0,0,0.02)', border: `1px solid ${lic.status === 'active' ? 'rgba(82,196,26,0.2)' : '#f0f0f0'}`, borderRadius: 8, padding: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text strong style={{ fontSize: 12 }}>{fmtCST(lic.auth_date)} ~ {lic.method === 'permanent' ? '永久' : fmtCST(lic.expiry_date)}</Text>
                        <StatusTag status={lic.status} remaining={0} />
                      </div>
                      <div style={{ fontSize: 11, color: '#999', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <span>{METHOD_MAP[lic.method] ? <Tag color={METHOD_MAP[lic.method].color} style={{ fontSize: 10 }}>{METHOD_MAP[lic.method].label}</Tag> : lic.method}</span>
                        <span>¥{(lic.amount || 0).toLocaleString()}</span>
                        <span>{lic.created_by}</span>
                      </div>
                    </div>
                  ),
                }))} />
              </Card>
            )}
          </>
        )}
      </Drawer>

      <Modal title={<><KeyOutlined style={{ color: '#52c41a', marginRight: 8 }} />更新授权</>}
        open={updateModalVisible} onCancel={() => setUpdateModalVisible(false)} footer={null}
        width={isMobile ? '100%' : 520} destroyOnClose>
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>站点标识</Text>
          <div style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 12px', fontFamily: 'monospace', fontSize: 13, fontWeight: 500, wordBreak: 'break-all', marginTop: 4 }}>
            {siteID}{siteID && machineID ? ':' : ''}{machineID}
            {(siteID || machineID) && <CopyOutlined style={{ marginLeft: 8, cursor: 'pointer', color: '#52c41a' }} onClick={() => copyText(`${siteID}:${machineID}`)} />}
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>License 授权码</Text>
          <Input.TextArea rows={4} value={updateToken} onChange={(e) => { setUpdateToken(e.target.value); setUpdateDecoded(null); }}
            placeholder="请粘贴License JWT授权码" style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 4 }} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Button type="primary" onClick={handleVerifyAndUpdate} loading={updateVerifying} icon={<SafetyCertificateOutlined />}>验证并解码</Button>
          {updateDecoded && <Button type="primary" danger onClick={handleConfirmUpdate} icon={<CheckCircleOutlined />}>确认更新授权</Button>}
        </div>
        {updateDecoded && (
          <div style={{ background: updateDecoded.valid ? 'rgba(82,196,26,0.04)' : 'rgba(255,77,79,0.04)', border: `1px solid ${updateDecoded.valid ? 'rgba(82,196,26,0.2)' : 'rgba(255,77,79,0.2)'}`, borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: updateDecoded.valid ? '#389e0d' : '#cf1322', marginBottom: 8 }}>
              {updateDecoded.valid ? <><CheckCircleOutlined style={{ marginRight: 4 }} />License 验证通过</> :
                <><CloseCircleOutlined style={{ marginRight: 4 }} />License 站点标识不匹配</>}
            </div>
            {updateDecoded.mismatches?.length > 0 && (
              <Alert type="error" style={{ marginBottom: 8 }} message={updateDecoded.mismatches.join('; ')} showIcon />
            )}
            <Descriptions column={isMobile ? 1 : 2} size="small">
              <Descriptions.Item label="授权方式">{METHOD_MAP[updateDecoded.claims?.method] ? <Tag color={METHOD_MAP[updateDecoded.claims.method].color}>{METHOD_MAP[updateDecoded.claims.method].label}</Tag> : updateDecoded.claims?.method}</Descriptions.Item>
              <Descriptions.Item label="授权时长">{updateDecoded.duration_desc || '—'}</Descriptions.Item>
              <Descriptions.Item label="授权日期">{updateDecoded.claims?.iat ? dayjs.unix(updateDecoded.claims.iat).tz(CNSH).format('YYYY/MM/DD HH:mm:ss') : '—'}</Descriptions.Item>
              <Descriptions.Item label="截止日期">{updateDecoded.claims?.method === 'permanent' ? '永久' : updateDecoded.claims?.exp ? dayjs.unix(updateDecoded.claims.exp).tz(CNSH).format('YYYY/MM/DD HH:mm:ss') : '—'}</Descriptions.Item>
              <Descriptions.Item label="SITE_ID">{updateDecoded.claims?.site_id}</Descriptions.Item>
              <Descriptions.Item label="Machine ID">{updateDecoded.claims?.machine_id}</Descriptions.Item>
              <Descriptions.Item label="授权功能" span={isMobile ? 1 : 2}><Space size={4} wrap>{(updateDecoded.claims?.features || []).map((ft: string) => { const c = FEATURE_MAP[ft]; return c ? <Tag key={ft} color={c.color}>{c.label}</Tag> : ft; })}</Space></Descriptions.Item>
              <Descriptions.Item label="金额"><span style={{ color: '#fa8c16', fontWeight: 600 }}>¥{(updateDecoded.claims?.amount || 0).toLocaleString()}</span></Descriptions.Item>
            </Descriptions>
          </div>
        )}
      </Modal>
    </div>
  );
}
