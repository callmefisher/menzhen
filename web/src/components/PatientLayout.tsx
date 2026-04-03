import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { CalendarOutlined, NumberOutlined, UserOutlined, HomeOutlined } from '@ant-design/icons';

const TABS = [
  { path: '/patient/home', icon: <HomeOutlined />, label: '首页' },
  { path: '/patient/appointments', icon: <CalendarOutlined />, label: '预约' },
  { path: '/patient/queue', icon: <NumberOutlined />, label: '取号' },
  { path: '/patient/me', icon: <UserOutlined />, label: '我的' },
];

export default function PatientLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f7fa' }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 56 }}>
        <Outlet />
      </div>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480,
        display: 'flex', background: '#fff',
        borderTop: '1px solid #f0f0f0',
        zIndex: 100,
      }}>
        {TABS.map((tab) => {
          const active = location.pathname.startsWith(tab.path);
          return (
            <div
              key={tab.path}
              onClick={() => navigate(tab.path)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '6px 0 4px', cursor: 'pointer',
                color: active ? '#52C41A' : '#aaa',
                fontSize: 20,
              }}
            >
              {tab.icon}
              <span style={{ fontSize: 10, marginTop: 2 }}>{tab.label}</span>
              {active && <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#52C41A', marginTop: 2 }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
