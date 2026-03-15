import { useState, useEffect, useCallback } from 'react';
import { Card, Form, Input, InputNumber, Button, message, Spin, Space } from 'antd';
import { getConfig, updateConfig } from '../../api/config';
import useIsMobile from '../../hooks/useIsMobile';

interface ConfigGroup {
  title: string;
  fields: {
    key: string;
    label: string;
    type: 'input' | 'password' | 'number';
    placeholder?: string;
  }[];
}

const CONFIG_GROUPS: ConfigGroup[] = [
  {
    title: '服务器配置',
    fields: [
      { key: 'SERVER_PORT', label: '服务端口', type: 'number', placeholder: '8080' },
    ],
  },
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
    title: 'JWT 配置',
    fields: [
      { key: 'JWT_SECRET', label: 'JWT 密钥', type: 'password', placeholder: 'change-me-in-production' },
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
  {
    title: 'DeepSeek AI',
    fields: [
      { key: 'DEEPSEEK_API_KEY', label: 'API 密钥', type: 'password', placeholder: '（选填）' },
      { key: 'DEEPSEEK_BASE_URL', label: 'API 地址', type: 'input', placeholder: '（选填）' },
      { key: 'DEEPSEEK_MODEL', label: '模型名称', type: 'input', placeholder: '（选填）' },
    ],
  },
  {
    title: '七牛云备份',
    fields: [
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
      { key: 'BACKUP_INTERVAL_MYSQL', label: 'MySQL 备份间隔(秒)', type: 'number', placeholder: '7200' },
      { key: 'BACKUP_INTERVAL_MINIO', label: 'MinIO 备份间隔(秒)', type: 'number', placeholder: '43200' },
    ],
  },
];

export default function SystemConfig() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const isMobile = useIsMobile();

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await getConfig()) as unknown as {
        data: { config: Record<string, string>; sensitive_set: string[] };
      };
      form.setFieldsValue(res.data.config);
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = form.getFieldsValue();
      const data: Record<string, string> = {};
      for (const [key, val] of Object.entries(values)) {
        data[key] = val != null ? String(val) : '';
      }
      await updateConfig(data);
      message.success('配置已保存，需重启 Docker 容器后生效');
    } catch {
      message.error('保存配置失败');
    } finally {
      setSaving(false);
    }
  };

  const renderField = (field: ConfigGroup['fields'][0]) => {
    switch (field.type) {
      case 'password':
        return <Input.Password placeholder={field.placeholder} />;
      case 'number':
        return <InputNumber placeholder={field.placeholder} style={{ width: '100%' }} />;
      default:
        return <Input placeholder={field.placeholder} />;
    }
  };

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
        {CONFIG_GROUPS.map((group) => (
          <Card
            key={group.title}
            title={group.title}
            size={isMobile ? 'small' : 'default'}
            style={{ marginBottom: 16 }}
          >
            {group.fields.map((field) => (
              <Form.Item key={field.key} name={field.key} label={field.label}>
                {renderField(field)}
              </Form.Item>
            ))}
          </Card>
        ))}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Space>
            <Button type="primary" size="large" loading={saving} onClick={handleSave}>
              保存配置
            </Button>
          </Space>
        </div>
      </Form>
    </div>
  );
}
