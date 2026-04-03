import { useState, useEffect } from 'react';
import { Form, Input, Button, message, Modal } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePatientAuth } from '../../store/patientAuth';
import { listTenantsByPhone, getTenantInfo, type TenantItem } from '../../api/patientAuth';

export default function PatientLogin() {
  const [loading, setLoading] = useState(false);
  const [tenantList, setTenantList] = useState<TenantItem[]>([]);
  const [tenantModalOpen, setTenantModalOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<{ phone: string; name: string } | null>(null);
  const [clinicName, setClinicName] = useState<string | null>(null);
  const { login, token } = usePatientAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm();

  useEffect(() => {
    const code = searchParams.get('code');
    if (code) {
      form.setFieldValue('tenant_code', code);
      getTenantInfo(code)
        .then((res) => {
          if (res.data?.tenant_name) setClinicName(res.data.tenant_name);
        })
        .catch(() => {
          // silently fall back to default title
        });
    }
  }, [searchParams, form]);

  useEffect(() => {
    if (token) navigate('/patient/home', { replace: true });
  }, [token, navigate]);

  const onFinish = async (values: { tenant_code?: string; phone: string; name: string }) => {
    if (values.tenant_code) {
      // QR code path or user manually typed tenant code
      setLoading(true);
      try {
        await login(values.tenant_code, values.phone, values.name);
        message.success('登录成功');
        navigate('/patient/home', { replace: true });
      } catch {
        // error handled by interceptor
      } finally {
        setLoading(false);
      }
    } else {
      // No tenant code — look up by phone
      setLoading(true);
      try {
        const res = await listTenantsByPhone(values.phone);
        const results = res.data ?? [];
        if (results.length === 0) {
          message.warning('未找到就诊记录，请扫描诊所二维码注册');
        } else if (results.length === 1) {
          await login(results[0].tenant_code, values.phone, values.name);
          message.success('登录成功');
          navigate('/patient/home', { replace: true });
        } else {
          setPendingValues({ phone: values.phone, name: values.name });
          setTenantList(results);
          setTenantModalOpen(true);
        }
      } catch {
        message.error('网络错误，请稍后重试');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleSelectTenant = async (tenantCode: string) => {
    if (!pendingValues) return;
    setTenantModalOpen(false);
    setLoading(true);
    try {
      await login(tenantCode, pendingValues.phone, pendingValues.name);
      message.success('登录成功');
      setPendingValues(null);
      navigate('/patient/home', { replace: true });
    } catch {
      // interceptor shows error toast; re-open modal so user can try again
      setTenantModalOpen(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #f6ffed 0%, #fff 55%)' }}>
      <div style={{
        background: 'linear-gradient(135deg, #52C41A, #389E0D)',
        padding: '32px 20px 48px', color: '#fff', position: 'relative',
      }}>
        <div style={{ fontSize: 36 }}>🌿</div>
        <div style={{ fontSize: 20, fontWeight: 600, marginTop: 8 }}>
          {clinicName ?? '患者服务中心'}
        </div>
        {clinicName && (
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>患者端</div>
        )}
        <div style={{
          position: 'absolute', bottom: -20, left: 0, right: 0, height: 40,
          background: '#fff', borderRadius: '50% 50% 0 0',
        }} />
      </div>
      <div style={{ padding: '32px 20px 20px' }}>
        <Form form={form} onFinish={onFinish} layout="vertical" size="large">
          <Form.Item
            name="tenant_code"
            label="诊所"
            getValueProps={(value) => ({
              value: clinicName && value ? `${clinicName}（${value}）` : (value ?? ''),
            })}
          >
            <Input
              prefix="🏥"
              placeholder="扫码自动填写（可选）"
              readOnly={!!clinicName}
              style={{ background: clinicName ? '#f6ffed' : undefined, cursor: clinicName ? 'default' : undefined }}
            />
          </Form.Item>
          <Form.Item name="phone" label="手机号" rules={[{ required: true, message: '请输入手机号' }, { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号' }]}>
            <Input prefix="📱" placeholder="请输入手机号" />
          </Form.Item>
          <Form.Item name="name" label="真实姓名" rules={[{ required: true, message: '请输入真实姓名' }, { max: 50, message: '姓名不超过50个字符' }]}>
            <Input prefix="👤" placeholder="请输入就诊时使用的真实姓名" />
          </Form.Item>
          <Form.Item style={{ marginTop: 8 }}>
            <Button type="primary" htmlType="submit" block loading={loading}
              style={{ background: '#52C41A', borderColor: '#52C41A', height: 44, fontSize: 16 }}>
              登录 / 注册
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center', color: '#aaa', fontSize: 12, marginTop: 8 }}>
          首次使用自动注册 · 无需设置密码
        </div>
      </div>

      <Modal
        open={tenantModalOpen}
        onCancel={() => { setTenantModalOpen(false); setPendingValues(null); }}
        footer={null}
        title="请选择诊所"
        destroyOnClose
      >
        {tenantList.map((tenant) => (
          <div
            key={tenant.tenant_id}
            onClick={() => handleSelectTenant(tenant.tenant_code)}
            style={{
              display: 'flex', alignItems: 'center', padding: '12px 0',
              borderBottom: '1px solid #f5f5f5', cursor: 'pointer', gap: 12,
            }}
          >
            <span style={{ fontSize: 24 }}>🏥</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{tenant.tenant_name}</div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>诊所代码: {tenant.tenant_code}</div>
            </div>
            <span style={{ color: '#52C41A' }}>→</span>
          </div>
        ))}
      </Modal>
    </div>
  );
}
