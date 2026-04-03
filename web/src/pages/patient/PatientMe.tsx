import { Card, Button, Descriptions } from 'antd';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { usePatientAuth } from '../../store/patientAuth';
import { useNavigate } from 'react-router-dom';

export default function PatientMe() {
  const { user, logout, tenantName } = usePatientAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/patient/login', { replace: true });
  };

  return (
    <div style={{ padding: 16 }}>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'linear-gradient(135deg, #52C41A, #389E0D)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <UserOutlined style={{ fontSize: 24, color: '#fff' }} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{user?.name ?? '—'}</div>
            <div style={{ fontSize: 13, color: '#888' }}>{tenantName ?? '患者'}</div>
          </div>
        </div>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="手机号">{user?.phone ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="所属诊所">{tenantName ?? '—'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Button
        danger
        block
        icon={<LogoutOutlined />}
        onClick={handleLogout}
        size="large"
      >
        退出登录
      </Button>
    </div>
  );
}
