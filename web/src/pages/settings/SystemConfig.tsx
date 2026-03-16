import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Form, Input, InputNumber, Button, message, Spin, Modal, Typography, Drawer, Alert, Divider, Statistic, List } from 'antd';
import { ReloadOutlined, QuestionCircleOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { getConfig, updateConfig, restartService } from '../../api/config';
import { cleanupOrphanFiles, type CleanupResult } from '../../api/storage';
import useIsMobile from '../../hooks/useIsMobile';

interface ConfigField {
  key: string;
  label: string;
  type: 'input' | 'password' | 'number';
  placeholder?: string;
  min?: number;
  rules?: Array<{ pattern: RegExp; message: string }>;
}

interface ConfigGroup {
  title: string;
  fields: ConfigField[];
}

interface ConfigSection {
  alertType: 'warning' | 'info' | 'success';
  alertMessage: string;
  alertDescription: string;
  colors: { bg: string; border: string; title: string };
  groups: ConfigGroup[];
}

const CONFIG_SECTIONS: ConfigSection[] = [
  {
    alertType: 'warning',
    alertMessage: '需先确认外部服务配置',
    alertDescription: '配置须与外部服务实际设置一致，保存后需点击「重启服务」生效',
    colors: { bg: '#fffbe6', border: '#fff1b8', title: '#8c6e00' },
    groups: [
      {
        title: '数据库配置',
        fields: [
          { key: 'DB_HOST', label: '数据库地址', type: 'input', placeholder: 'localhost' },
          { key: 'DB_PORT', label: '数据库端口', type: 'number', placeholder: '3306' },
          { key: 'DB_USER', label: '数据库用户名', type: 'input', placeholder: 'menzhen' },
          { key: 'DB_PASSWORD', label: '数据库密码', type: 'password', placeholder: 'menzhen123' },
          { key: 'DB_NAME', label: '数据库名', type: 'input', placeholder: 'menzhen' },
        ],
      },
      {
        title: 'MinIO 文件存储',
        fields: [
          { key: 'MINIO_ENDPOINT', label: 'MinIO 地址', type: 'input', placeholder: 'localhost:9000' },
          { key: 'MINIO_ACCESS_KEY', label: 'Access Key', type: 'password', placeholder: 'minioadmin' },
          { key: 'MINIO_SECRET_KEY', label: 'Secret Key', type: 'password', placeholder: 'minioadmin' },
          { key: 'MINIO_BUCKET', label: '存储桶名', type: 'input', placeholder: 'menzhen' },
        ],
      },
    ],
  },
  {
    alertType: 'info',
    alertMessage: '仅需重启 API 服务',
    alertDescription: '保存后点击「重启服务」即可生效，无需外部操作',
    colors: { bg: '#e6f4ff', border: '#bae0ff', title: '#0958d9' },
    groups: [
      {
        title: '服务器配置',
        fields: [
          { key: 'SERVER_PORT', label: '服务端口', type: 'number', placeholder: '8080' },
        ],
      },
      {
        title: 'JWT 配置',
        fields: [
          { key: 'JWT_SECRET', label: 'JWT 密钥', type: 'password', placeholder: 'change-me-in-production' },
        ],
      },
      {
        title: 'DeepSeek AI',
        fields: [
          { key: 'DEEPSEEK_API_KEY', label: 'API 密钥', type: 'password', placeholder: '（选填）' },
          { key: 'DEEPSEEK_BASE_URL', label: 'API 地址', type: 'input', placeholder: '（选填）' },
          { key: 'DEEPSEEK_MODEL', label: '模型名称', type: 'input', placeholder: '（选填）' },
        ],
      },
    ],
  },
  {
    alertType: 'success',
    alertMessage: '自动生效（无需重启）',
    alertDescription: '保存后下次备份执行时自动使用新值',
    colors: { bg: '#f6ffed', border: '#b7eb8f', title: '#389e0d' },
    groups: [
      {
        title: '七牛云备份',
        fields: [
          { key: 'SITE_ID', label: '站点标识 (SITE_ID)', type: 'input', placeholder: 'default（多服务器部署时区分备份）', rules: [{ pattern: /^[A-Za-z0-9_-]*$/, message: '仅允许字母、数字、-、_' }] },
          { key: 'QINIU_ACCESS_KEY', label: 'Access Key', type: 'password', placeholder: '（选填）' },
          { key: 'QINIU_SECRET_KEY', label: 'Secret Key', type: 'password', placeholder: '（选填）' },
          { key: 'QINIU_BUCKET', label: '存储空间名', type: 'input', placeholder: '（选填）' },
          { key: 'QINIU_KEY_PREFIX', label: '上传路径前缀', type: 'input', placeholder: 'menzhen-backup/' },
          { key: 'QINIU_DOMAIN', label: '下载域名', type: 'input', placeholder: 'public.qnlinking.com' },
          { key: 'QINIU_RETAIN_MYSQL', label: 'MySQL 备份保留数', type: 'number', placeholder: '5' },
          { key: 'QINIU_RETAIN_MINIO', label: 'MinIO 备份保留数', type: 'number', placeholder: '5' },
        ],
      },
      {
        title: '备份间隔',
        fields: [
          { key: 'BACKUP_INTERVAL_MYSQL', label: 'MySQL 备份间隔(秒)', type: 'number', placeholder: '7200', min: 60 },
          { key: 'BACKUP_INTERVAL_MINIO', label: 'MinIO 备份间隔(秒)', type: 'number', placeholder: '43200', min: 60 },
        ],
      },
    ],
  },
];

// Sensitive fields that require external service changes first
const RISK_WARNINGS: Record<string, string> = {
  DB_HOST: '修改数据库地址前，请确认目标 MySQL 在该地址可访问，否则服务将无法连接数据库',
  DB_PORT: '修改数据库端口前，请确认 MySQL 在该端口运行，否则服务将无法连接数据库',
  DB_USER: '修改数据库用户名前，请确认该用户已在 MySQL 中创建并授权，否则服务将无法连接数据库',
  DB_PASSWORD: '修改数据库密码前，请确认已在 MySQL 中完成密码变更，否则服务将无法连接数据库',
  DB_NAME: '修改数据库名前，请确认该数据库已在 MySQL 中创建，否则服务将无法连接数据库',
  MINIO_ENDPOINT: '修改 MinIO 地址前，请确认 MinIO 在该地址可访问，否则文件存储将不可用',
  MINIO_ACCESS_KEY: '修改 MinIO 密钥前，请确认已在 MinIO 中完成密钥变更，否则文件存储将不可用',
  MINIO_SECRET_KEY: '修改 MinIO 密钥前，请确认已在 MinIO 中完成密钥变更，否则文件存储将不可用',
  MINIO_BUCKET: '修改存储桶名前，请确认该桶已在 MinIO 中创建，否则文件存储将不可用',
};

export default function SystemConfig() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useIsMobile();
  // Store initial config to detect changes
  const initialConfig = useRef<Record<string, string>>({});
  // Storage cleanup state
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);

  // Collect all number-type field keys for type conversion
  const numberFields = new Set(
    CONFIG_SECTIONS.flatMap(s => s.groups.flatMap(g => g.fields.filter(f => f.type === 'number').map(f => f.key)))
  );

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await getConfig()) as unknown as {
        data: { config: Record<string, string>; sensitive_set: string[] };
      };
      // Convert number fields from string to number for InputNumber compatibility
      const config = { ...res.data.config };
      for (const key of numberFields) {
        const val = config[key];
        if (val != null && val !== '') {
          const num = Number(val);
          if (!isNaN(num)) {
            (config as Record<string, unknown>)[key] = num;
          }
        }
      }
      form.setFieldsValue(config);
      initialConfig.current = { ...res.data.config };
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const doSave = async () => {
    setSaving(true);
    try {
      const values = form.getFieldsValue();
      const data: Record<string, string> = {};
      for (const [key, val] of Object.entries(values)) {
        data[key] = val != null ? String(val) : '';
      }
      await updateConfig(data);
      initialConfig.current = { ...data };
      message.success('配置已保存，部分配置需点击「重启服务」生效');
    } catch {
      message.error('保存配置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const values = form.getFieldsValue();
    // Detect which risk fields were changed
    const warnings: string[] = [];
    for (const key of Object.keys(RISK_WARNINGS)) {
      const current = values[key] != null ? String(values[key]) : '';
      const original = initialConfig.current[key] ?? '';
      if (current !== original) {
        // Deduplicate same warning text (MINIO_ACCESS_KEY and MINIO_SECRET_KEY share text)
        const warn = RISK_WARNINGS[key];
        if (!warnings.includes(warn)) {
          warnings.push(warn);
        }
      }
    }
    if (warnings.length > 0) {
      Modal.confirm({
        title: '风险提示',
        content: (
          <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
            {warnings.map((w, i) => (
              <li key={i} style={{ marginBottom: 4 }}>{w}</li>
            ))}
          </ul>
        ),
        okText: '确认保存',
        okType: 'danger',
        cancelText: '取消',
        onOk: doSave,
      });
    } else {
      await doSave();
    }
  };

  const handleRestart = () => {
    Modal.confirm({
      title: '确认重启服务',
      content: '重启期间服务将短暂不可用（约 5-10 秒），确定要重启吗？',
      okText: '确认重启',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setRestarting(true);
        try {
          await restartService();
          message.success('服务正在重启，请稍候...');
          // 等待服务重启后自动刷新页面
          setTimeout(() => window.location.reload(), 6000);
        } catch {
          message.error('重启请求失败');
          setRestarting(false);
        }
      },
    });
  };

  const handleScanOrphans = async () => {
    setScanning(true);
    setCleanupResult(null);
    try {
      const res = (await cleanupOrphanFiles(true)) as unknown as { data: CleanupResult };
      setCleanupResult(res.data);
      if (res.data.orphan_count === 0) {
        message.success('未发现孤立文件');
      }
    } catch {
      message.error('扫描失败');
    } finally {
      setScanning(false);
    }
  };

  const handleCleanOrphans = () => {
    if (!cleanupResult || cleanupResult.orphan_count === 0) return;
    Modal.confirm({
      title: '确认清理孤立文件',
      content: `将删除 ${cleanupResult.orphan_count} 个无引用文件，此操作不可撤销，确定要清理吗？`,
      okText: '确认清理',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setCleaning(true);
        try {
          const res = (await cleanupOrphanFiles(false)) as unknown as { data: CleanupResult };
          setCleanupResult(res.data);
          const deletedCount = res.data.deleted_files?.length ?? 0;
          const failedCount = res.data.failed_files?.length ?? 0;
          if (failedCount > 0) {
            message.warning(`已清理 ${deletedCount} 个文件，${failedCount} 个失败`);
          } else {
            message.success(`已清理 ${deletedCount} 个孤立文件`);
          }
        } catch {
          message.error('清理失败');
        } finally {
          setCleaning(false);
        }
      },
    });
  };

  const renderField = (field: ConfigField) => {
    switch (field.type) {
      case 'password':
        return <Input.Password placeholder={field.placeholder} />;
      case 'number':
        return <InputNumber placeholder={field.placeholder} min={field.min} style={{ width: '100%' }} />;
      default:
        return <Input placeholder={field.placeholder} />;
    }
  };

  const renderConfigItem = (name: string, desc: string, prereq?: string) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <Typography.Text code style={{ flexShrink: 0, fontSize: 12 }}>{name}</Typography.Text>
        <Typography.Text style={{ fontSize: 13, color: '#595959' }}>{desc}</Typography.Text>
      </div>
      {prereq && (
        <div style={{ fontSize: 12, color: '#d48806', paddingLeft: 4, marginTop: 2, lineHeight: 1.5 }}>
          → {prereq}
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 50 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Form form={form} layout="vertical">
        {CONFIG_SECTIONS.map((section) => (
          <div key={section.alertMessage} style={{ marginBottom: 20 }}>
            <Alert
              type={section.alertType}
              showIcon
              message={section.alertMessage}
              description={section.alertDescription}
              style={{ marginBottom: 12 }}
            />
            <div style={{
              background: section.colors.bg,
              border: `1px solid ${section.colors.border}`,
              borderRadius: 8,
              padding: isMobile ? '16px 12px 4px' : '20px 24px 4px',
            }}>
              {section.groups.map((group, gi) => (
                <div key={group.title}>
                  {gi > 0 && <Divider style={{ margin: '4px 0 16px' }} />}
                  <Typography.Text strong style={{ fontSize: 14, color: section.colors.title, display: 'block', marginBottom: 12 }}>
                    {group.title}
                  </Typography.Text>
                  {group.fields.map((field) => (
                    <Form.Item key={field.key} name={field.key} label={field.label} rules={field.rules} style={{ marginBottom: 16 }}>
                      {renderField(field)}
                    </Form.Item>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <Button
            type="primary"
            size="large"
            loading={saving}
            onClick={handleSave}
            block={isMobile}
          >
            保存配置
          </Button>
        </div>
      </Form>

      <Card
        size={isMobile ? 'small' : 'default'}
        style={{ marginBottom: 24 }}
      >
        <div style={isMobile ? {} : { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ marginBottom: isMobile ? 12 : 0 }}>
            <Typography.Text strong>重启服务</Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              修改配置后需重启服务才能生效，重启期间服务短暂不可用
            </Typography.Text>
            <br />
            <Typography.Link
              style={{ fontSize: 13 }}
              onClick={() => setDrawerOpen(true)}
            >
              <QuestionCircleOutlined /> 查看配置影响说明
            </Typography.Link>
          </div>
          <Button
            danger
            icon={<ReloadOutlined />}
            loading={restarting}
            onClick={handleRestart}
            style={isMobile ? { width: '100%' } : undefined}
          >
            {restarting ? '重启中...' : '重启服务'}
          </Button>
        </div>
      </Card>

      <Card
        size={isMobile ? 'small' : 'default'}
        style={{ marginBottom: 24 }}
      >
        <div style={{ marginBottom: 12 }}>
          <Typography.Text strong>存储清理</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            扫描并清理 MinIO 中无数据库引用的孤立文件（如已删除病历的附件、替换后的旧文件等）
          </Typography.Text>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: cleanupResult ? 16 : 0 }}>
          <Button
            icon={<SearchOutlined />}
            loading={scanning}
            onClick={handleScanOrphans}
          >
            扫描孤立文件
          </Button>
          {cleanupResult && cleanupResult.orphan_count > 0 && !cleanupResult.deleted_files && (
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={cleaning}
              onClick={handleCleanOrphans}
            >
              清理 {cleanupResult.orphan_count} 个文件
            </Button>
          )}
        </div>
        {cleanupResult && (
          <div>
            <div style={{ display: 'flex', gap: isMobile ? 16 : 32, flexWrap: 'wrap', marginBottom: 12 }}>
              <Statistic title="存储文件总数" value={cleanupResult.total_files} />
              <Statistic title="有引用" value={cleanupResult.referenced_count} />
              <Statistic title="孤立文件" value={cleanupResult.orphan_count} valueStyle={cleanupResult.orphan_count > 0 ? { color: '#cf1322' } : undefined} />
              {cleanupResult.deleted_files && (
                <Statistic title="已清理" value={cleanupResult.deleted_files.length} valueStyle={{ color: '#3f8600' }} />
              )}
            </div>
            {cleanupResult.orphan_files && cleanupResult.orphan_files.length > 0 && !cleanupResult.deleted_files && (
              <List
                size="small"
                bordered
                dataSource={cleanupResult.orphan_files.slice(0, 50)}
                style={{ maxHeight: 200, overflow: 'auto' }}
                header={<Typography.Text type="secondary" style={{ fontSize: 12 }}>孤立文件列表{cleanupResult.orphan_files.length > 50 ? `（显示前 50 个，共 ${cleanupResult.orphan_files.length} 个）` : ''}</Typography.Text>}
                renderItem={(item: string) => <List.Item style={{ padding: '4px 12px', fontSize: 12 }}><Typography.Text code ellipsis style={{ maxWidth: '100%' }}>{item}</Typography.Text></List.Item>}
              />
            )}
            {cleanupResult.failed_files && cleanupResult.failed_files.length > 0 && (
              <Alert type="warning" showIcon message={`${cleanupResult.failed_files.length} 个文件删除失败`} style={{ marginTop: 8 }} />
            )}
          </div>
        )}
      </Card>

      <Drawer
        title="配置影响说明"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={isMobile ? '100%' : 520}
        styles={{ body: { padding: isMobile ? '12px 16px' : '16px 24px' } }}
      >
        {/* 需先确认外部服务配置 */}
        <Alert
          type="warning"
          showIcon
          message="需先确认外部服务配置"
          description="以下配置必须与对应服务的实际设置一致，否则服务将无法连接。保存后需点击「重启服务」生效。"
          style={{ marginBottom: 12 }}
        />
        <div style={{ background: '#fffbe6', borderRadius: 8, padding: '12px 16px', marginBottom: 24, border: '1px solid #fff1b8' }}>
          <Typography.Text strong style={{ fontSize: 13, color: '#8c6e00' }}>MySQL 数据库</Typography.Text>
          <div style={{ marginTop: 8 }}>
            {renderConfigItem('DB_HOST', '数据库地址', 'MySQL 须在该地址可访问')}
            {renderConfigItem('DB_PORT', '数据库端口', 'MySQL 须在该端口运行')}
            {renderConfigItem('DB_USER', '数据库用户名', '该用户须已在 MySQL 中创建并授权')}
            {renderConfigItem('DB_PASSWORD', '数据库密码', '密码须与 MySQL 中设置一致')}
            {renderConfigItem('DB_NAME', '数据库名', '该数据库须已在 MySQL 中创建')}
          </div>
          <Divider style={{ margin: '12px 0' }} />
          <Typography.Text strong style={{ fontSize: 13, color: '#8c6e00' }}>MinIO 文件存储</Typography.Text>
          <div style={{ marginTop: 8 }}>
            {renderConfigItem('MINIO_ENDPOINT', 'MinIO 地址', 'MinIO 须在该地址可访问')}
            {renderConfigItem('MINIO_ACCESS_KEY', 'Access Key', '密钥须与 MinIO 中设置一致')}
            {renderConfigItem('MINIO_SECRET_KEY', 'Secret Key', '密钥须与 MinIO 中设置一致')}
            {renderConfigItem('MINIO_BUCKET', '存储桶名', '该桶须已在 MinIO 中创建')}
          </div>
        </div>

        {/* 仅需重启 API 服务 */}
        <Alert
          type="info"
          showIcon
          message="仅需重启 API 服务"
          description="保存后点击「重启服务」即可生效，无需外部操作。"
          style={{ marginBottom: 12 }}
        />
        <div style={{ background: '#e6f4ff', borderRadius: 8, padding: '12px 16px', marginBottom: 24, border: '1px solid #bae0ff' }}>
          {renderConfigItem('SERVER_PORT', '服务端口')}
          {renderConfigItem('JWT_SECRET', 'JWT 密钥（修改后用户需重新登录）')}
          <Divider style={{ margin: '12px 0' }} />
          <Typography.Text strong style={{ fontSize: 13, color: '#0958d9' }}>DeepSeek AI</Typography.Text>
          <div style={{ marginTop: 8 }}>
            {renderConfigItem('DEEPSEEK_API_KEY', 'API 密钥')}
            {renderConfigItem('DEEPSEEK_BASE_URL', 'API 地址')}
            {renderConfigItem('DEEPSEEK_MODEL', '模型名称')}
          </div>
        </div>

        {/* 自动生效 */}
        <Alert
          type="success"
          showIcon
          message="自动生效（无需重启）"
          description="保存后下次备份执行时自动使用新值。"
          style={{ marginBottom: 12 }}
        />
        <div style={{ background: '#f6ffed', borderRadius: 8, padding: '12px 16px', marginBottom: 24, border: '1px solid #b7eb8f' }}>
          <Typography.Text strong style={{ fontSize: 13, color: '#389e0d' }}>七牛云备份</Typography.Text>
          <div style={{ marginTop: 8 }}>
            {renderConfigItem('SITE_ID', '站点标识（多服务器部署时区分备份，默认 default）')}
            {renderConfigItem('QINIU_ACCESS_KEY', '七牛 Access Key')}
            {renderConfigItem('QINIU_SECRET_KEY', '七牛 Secret Key')}
            {renderConfigItem('QINIU_BUCKET', '存储空间名')}
            {renderConfigItem('QINIU_KEY_PREFIX', '上传路径前缀')}
            {renderConfigItem('QINIU_DOMAIN', '下载域名')}
            {renderConfigItem('QINIU_RETAIN_MYSQL', 'MySQL 备份保留数')}
            {renderConfigItem('QINIU_RETAIN_MINIO', 'MinIO 备份保留数')}
          </div>
          <Divider style={{ margin: '12px 0' }} />
          <Typography.Text strong style={{ fontSize: 13, color: '#389e0d' }}>备份间隔</Typography.Text>
          <div style={{ marginTop: 8 }}>
            {renderConfigItem('BACKUP_INTERVAL_MYSQL', 'MySQL 备份间隔（秒）')}
            {renderConfigItem('BACKUP_INTERVAL_MINIO', 'MinIO 备份间隔（秒）')}
          </div>
        </div>
      </Drawer>
    </div>
  );
}
