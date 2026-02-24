import { useState, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, theme, Dropdown } from 'antd';
import {
  MedicineBoxOutlined,
  UserOutlined,
  FileSearchOutlined,
  SettingOutlined,
  TeamOutlined,
  SafetyOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  ExperimentOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import type { MenuProps as AntMenuProps } from 'antd';
import { useAuth } from '../store/auth';

const { Header, Sider, Content } = AntLayout;

type MenuItem = Required<AntMenuProps>['items'][number];

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const menuItems = useMemo(() => {
    const items: MenuItem[] = [
      {
        key: '/records',
        icon: <MedicineBoxOutlined />,
        label: '病历列表',
      },
    ];

    if (hasPermission('patient:read')) {
      items.push({
        key: '/patients',
        icon: <UserOutlined />,
        label: '患者管理',
      });
    }

    if (hasPermission('oplog:read')) {
      items.push({
        key: '/oplogs',
        icon: <FileSearchOutlined />,
        label: '操作日志',
      });
    }

    // TCM menu group
    const canReadHerbs = hasPermission('herb:read');
    const canReadFormulas = hasPermission('formula:read');

    if (canReadHerbs || canReadFormulas) {
      const tcmChildren: MenuItem[] = [];
      if (canReadHerbs) {
        tcmChildren.push({
          key: '/herbs',
          icon: <ExperimentOutlined />,
          label: '中药查询',
        });
      }
      if (canReadFormulas) {
        tcmChildren.push({
          key: '/formulas',
          icon: <ReadOutlined />,
          label: '方剂查询',
        });
      }
      items.push({
        key: '/tcm',
        icon: <ExperimentOutlined />,
        label: '中医药',
        children: tcmChildren,
      });
    }

    const canManageUsers = hasPermission('user:manage');
    const canManageRoles = hasPermission('role:manage');

    if (canManageUsers || canManageRoles) {
      const settingsChildren: MenuItem[] = [];
      if (canManageUsers) {
        settingsChildren.push({
          key: '/settings/users',
          icon: <TeamOutlined />,
          label: '用户管理',
        });
      }
      if (canManageRoles) {
        settingsChildren.push({
          key: '/settings/roles',
          icon: <SafetyOutlined />,
          label: '角色管理',
        });
      }
      items.push({
        key: '/settings',
        icon: <SettingOutlined />,
        label: '系统设置',
        children: settingsChildren,
      });
    }

    return items;
  }, [hasPermission]);

  // Determine selected keys from current path
  const selectedKeys = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/settings/roles')) return ['/settings/roles'];
    if (path.startsWith('/settings/users')) return ['/settings/users'];
    if (path.startsWith('/patients')) return ['/patients'];
    if (path.startsWith('/oplogs')) return ['/oplogs'];
    if (path.startsWith('/herbs')) return ['/herbs'];
    if (path.startsWith('/formulas')) return ['/formulas'];
    if (path.startsWith('/records')) return ['/records'];
    return ['/records'];
  }, [location.pathname]);

  const openKeys = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/settings')) return ['/settings'];
    if (path.startsWith('/herbs') || path.startsWith('/formulas')) return ['/tcm'];
    return [];
  }, [location.pathname]);

  const handleMenuClick = (info: { key: string }) => {
    navigate(info.key);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const userMenuItems: AntMenuProps['items'] = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ];

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        breakpoint="lg"
        onBreakpoint={(broken) => {
          if (broken) setCollapsed(true);
        }}
      >
        <div
          style={{
            height: 32,
            margin: 16,
            color: '#fff',
            fontSize: collapsed ? 14 : 18,
            fontWeight: 'bold',
            textAlign: 'center',
            lineHeight: '32px',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          {collapsed ? '门诊' : '门诊管理系统'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selectedKeys}
          defaultOpenKeys={openKeys}
          items={menuItems}
          onClick={handleMenuClick}
        />
      </Sider>
      <AntLayout>
        <Header
          style={{
            padding: '0 16px',
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ fontSize: 16, width: 48, height: 48 }}
          />
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <Button type="text" icon={<UserOutlined />}>
              {user?.real_name || user?.username || '用户'}
            </Button>
          </Dropdown>
        </Header>
        <Content
          style={{
            margin: '16px',
            padding: 24,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
            minHeight: 280,
          }}
        >
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
