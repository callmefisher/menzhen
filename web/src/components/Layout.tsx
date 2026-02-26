import { useState, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, theme, Dropdown, Modal, Form, Input, message } from 'antd';
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
  KeyOutlined,
  ExperimentOutlined,
  ReadOutlined,
  BankOutlined,
} from '@ant-design/icons';
import type { MenuProps as AntMenuProps } from 'antd';
import { useAuth } from '../store/auth';
import { changePassword } from '../api/auth';

const { Header, Sider, Content } = AntLayout;

type MenuItem = Required<AntMenuProps>['items'][number];

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordForm] = Form.useForm();
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const menuItems = useMemo(() => {
    const items: MenuItem[] = [];

    if (hasPermission('patient:read')) {
      items.push({
        key: '/patients',
        icon: <UserOutlined />,
        label: '患者管理',
      });
    }

    items.push({
      key: '/records',
      icon: <MedicineBoxOutlined />,
      label: '病历列表',
    });

    // TCM menu group - accessible to all authenticated users
    const tcmChildren: MenuItem[] = [
      {
        key: '/herbs',
        icon: <ExperimentOutlined />,
        label: '中药查询',
      },
      {
        key: '/formulas',
        icon: <ReadOutlined />,
        label: '方剂查询',
      },
    ];
    items.push({
      key: '/tcm',
      icon: <ExperimentOutlined />,
      label: '中医药',
      children: tcmChildren,
    });

    const canManageUsers = hasPermission('user:manage');
    const canManageRoles = hasPermission('role:manage');
    const canManageTenants = hasPermission('tenant:manage');

    if (canManageUsers || canManageRoles || canManageTenants) {
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
      if (canManageTenants) {
        settingsChildren.push({
          key: '/settings/tenants',
          icon: <BankOutlined />,
          label: '诊所管理',
        });
      }
      items.push({
        key: '/settings',
        icon: <SettingOutlined />,
        label: '系统设置',
        children: settingsChildren,
      });
    }

    if (hasPermission('oplog:read')) {
      items.push({
        key: '/oplogs',
        icon: <FileSearchOutlined />,
        label: '操作日志',
      });
    }

    return items;
  }, [hasPermission]);

  // Determine selected keys from current path
  const selectedKeys = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/settings/roles')) return ['/settings/roles'];
    if (path.startsWith('/settings/users')) return ['/settings/users'];
    if (path.startsWith('/settings/tenants')) return ['/settings/tenants'];
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
    return ['/tcm', '/settings'];
  }, [location.pathname]);

  const handleMenuClick = (info: { key: string }) => {
    navigate(info.key);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleChangePassword = async () => {
    try {
      const values = await passwordForm.validateFields();
      setPasswordLoading(true);
      await changePassword({
        old_password: values.old_password,
        new_password: values.new_password,
      });
      message.success('密码修改成功');
      setPasswordModalOpen(false);
      passwordForm.resetFields();
    } catch {
      // Validation or API error
    } finally {
      setPasswordLoading(false);
    }
  };

  const userMenuItems: AntMenuProps['items'] = [
    {
      key: 'change-password',
      icon: <KeyOutlined />,
      label: '修改密码',
      onClick: () => setPasswordModalOpen(true),
    },
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

      {/* Change password modal */}
      <Modal
        title="修改密码"
        open={passwordModalOpen}
        onOk={handleChangePassword}
        onCancel={() => {
          setPasswordModalOpen(false);
          passwordForm.resetFields();
        }}
        confirmLoading={passwordLoading}
        okText="确认修改"
        cancelText="取消"
        destroyOnClose
      >
        <Form
          form={passwordForm}
          layout="vertical"
          autoComplete="off"
        >
          <Form.Item
            label="旧密码"
            name="old_password"
            rules={[{ required: true, message: '请输入旧密码' }]}
          >
            <Input.Password placeholder="请输入旧密码" />
          </Form.Item>

          <Form.Item
            label="新密码"
            name="new_password"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少 6 个字符' },
            ]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>

          <Form.Item
            label="确认新密码"
            name="confirm_password"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </AntLayout>
  );
}
