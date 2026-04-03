import { useState, useEffect } from 'react';
import { Form, Input, Button, message } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePatientAuth } from '../../store/patientAuth';

export default function PatientLogin() {
  const [loading, setLoading] = useState(false);
  const { login, token } = usePatientAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm();

  useEffect(() => {
    const code = searchParams.get('code');
    if (code) form.setFieldValue('tenant_code', code);
  }, [searchParams, form]);

  useEffect(() => {
    if (token) navigate('/patient/home', { replace: true });
  }, [token, navigate]);

  const onFinish = async (values: { tenant_code: string; phone: string; name: string }) => {
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
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #f6ffed 0%, #fff 55%)' }}>
      <div style={{
        background: 'linear-gradient(135deg, #52C41A, #389E0D)',
        padding: '32px 20px 48px', color: '#fff', position: 'relative',
      }}>
        <div style={{ fontSize: 36 }}>🌿</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>患者服务中心</div>
        <div style={{
          position: 'absolute', bottom: -20, left: 0, right: 0, height: 40,
          background: '#fff', borderRadius: '50% 50% 0 0',
        }} />
      </div>
      <div style={{ padding: '32px 20px 20px' }}>
        <Form form={form} onFinish={onFinish} layout="vertical" size="large">
          <Form.Item name="tenant_code" label="诊所代码" rules={[{ required: true, message: '请输入诊所代码' }]}>
            <Input prefix="🏥" placeholder="由诊所提供（扫码自动填写）" />
          </Form.Item>
          <Form.Item name="phone" label="手机号" rules={[{ required: true, message: '请输入手机号' }, { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号' }]}>
            <Input prefix="📱" placeholder="请输入手机号" />
          </Form.Item>
          <Form.Item name="name" label="真实姓名" rules={[{ required: true, message: '请输入真实姓名' }]}>
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
    </div>
  );
}
