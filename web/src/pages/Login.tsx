import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Form, Input, Button, Checkbox, Card, message } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  MedicineBoxOutlined,
} from '@ant-design/icons';
import { useAuth } from '../store/auth';

interface LoginFormValues {
  username: string;
  password: string;
  remember?: boolean;
}

export default function Login() {
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (values: LoginFormValues) => {
    setLoading(true);
    try {
      await login(values.username, values.password);
      message.success('登录成功');
      navigate('/records', { replace: true });
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
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <MedicineBoxOutlined
            style={{ fontSize: 40, color: '#1677ff', marginBottom: 12 }}
          />
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: '#1a1a1a',
              margin: 0,
            }}
          >
            患者病历管理系统
          </h1>
        </div>

        <Form<LoginFormValues>
          name="login"
          onFinish={handleSubmit}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>

          <Form.Item name="remember" valuePropName="checked">
            <Checkbox>记住我</Checkbox>
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center' }}>
          还没有账号？
          <Link to="/register">立即注册</Link>
        </div>
      </Card>
    </div>
  );
}
