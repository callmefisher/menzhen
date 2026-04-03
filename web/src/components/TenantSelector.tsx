import { useState, useEffect, useRef } from 'react';
import { Select, Space, Typography, message } from 'antd';
import { BankOutlined } from '@ant-design/icons';
import { listTenants } from '../api/tenant';
import { useAuth } from '../store/auth';

interface TenantOption {
  id: number;
  name: string;
  code: string;
}

interface TenantSelectorProps {
  value: number;
  onChange: (tenantId: number) => void;
}

export default function TenantSelector({ value, onChange }: TenantSelectorProps) {
  const { isSuperAdmin, user: currentUser } = useAuth();
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [loading, setLoading] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Sync selectedTenantId with currentUser once auth store finishes loading.
  // Uses ref so onChange identity changes don't re-trigger this effect.
  useEffect(() => {
    if (currentUser?.tenant_id && value === 0) {
      onChangeRef.current(currentUser.tenant_id);
    }
  }, [currentUser?.tenant_id, value]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    setLoading(true);
    listTenants({ page: 1, size: 200 })
      .then((res: unknown) => {
        const body = res as { data?: { list?: TenantOption[] } };
        setTenants(body.data?.list ?? []);
      })
      .catch(() => message.error('加载诊所列表失败'))
      .finally(() => setLoading(false));
  }, [isSuperAdmin]);

  if (!isSuperAdmin) return null;

  return (
    <Space style={{ marginBottom: 16 }}>
      <BankOutlined style={{ color: '#1677ff' }} />
      <Typography.Text type="secondary">当前诊所：</Typography.Text>
      <Select
        style={{ minWidth: 200 }}
        loading={loading}
        placeholder={loading ? '加载诊所列表...' : '请选择诊所'}
        value={loading ? undefined : (value > 0 ? value : undefined)}
        onChange={onChange}
        showSearch
        filterOption={(input, option) =>
          String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
        }
        options={tenants.map((t) => ({
          value: t.id,
          label: `${t.name}（${t.code}）`,
        }))}
      />
    </Space>
  );
}
