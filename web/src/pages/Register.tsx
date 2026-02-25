import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, message } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  BankOutlined,
  IdcardOutlined,
  PhoneOutlined,
} from '@ant-design/icons';
import { register } from '../api/auth';

interface RegisterFormValues {
  tenant_code: string;
  username: string;
  password: string;
  confirm: string;
  real_name: string;
  phone: string;
}

export default function Register() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (values: RegisterFormValues) => {
    setLoading(true);
    try {
      await register({
        tenant_code: values.tenant_code,
        username: values.username,
        password: values.password,
        real_name: values.real_name,
        phone: values.phone || '',
      });
      message.success('注册成功，请登录');
      navigate('/login', { replace: true });
    } catch {
      // Error is already handled by the request interceptor (message.error)
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #e8f4fd 0%, #f0f7ff 50%, #ffffff 100%)',
      }}
    >
      <Card
        style={{
          width: 400,
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.08)',
          borderRadius: 8,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: '#1a1a1a',
              margin: 0,
            }}
          >
            注册账号
          </h1>
        </div>

        <Form<RegisterFormValues>
          name="register"
          onFinish={handleSubmit}
          autoComplete="off"
          size="large"
          initialValues={{ tenant_code: 'default' }}
        >
          <Form.Item
            name="tenant_code"
            rules={[{ required: true, message: '请输入诊所编码' }]}
          >
            <Input prefix={<BankOutlined />} placeholder="诊所编码（默认：default）" />
          </Form.Item>

          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码至少 6 个字符' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>

          <Form.Item
            name="confirm"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="确认密码" />
          </Form.Item>

          <Form.Item
            name="real_name"
            rules={[{ required: true, message: '请输入真实姓名' }]}
          >
            <Input prefix={<IdcardOutlined />} placeholder="真实姓名" />
          </Form.Item>

          <Form.Item name="phone">
            <Input prefix={<PhoneOutlined />} placeholder="手机号（选填）" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              注册
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center' }}>
          已有账号？
          <Link to="/login">返回登录</Link>
        </div>
      </Card>
    </div>
  );
}
