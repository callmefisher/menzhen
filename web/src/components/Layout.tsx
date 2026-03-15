import { useState, useMemo, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, theme, Dropdown, Modal, Form, Input, message, Drawer } from 'antd';
import {
  MedicineBoxOutlined,
  UserOutlined,
  FileSearchOutlined,
  SettingOutlined,
  TeamOutlined,
  SafetyOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MenuOutlined,
  LogoutOutlined,
  KeyOutlined,
  ExperimentOutlined,
  ReadOutlined,
  BankOutlined,
  ApartmentOutlined,
  HeartOutlined,
  CloudOutlined,
  BookOutlined,
  ShopOutlined,
  AlertOutlined,
  CalendarOutlined,
  FileTextOutlined,
  BarChartOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import type { MenuProps as AntMenuProps } from 'antd';
import { useAuth } from '../store/auth';
import { changePassword } from '../api/auth';
import { listInventoryDrugs } from '../api/inventory';
import type { InventoryDrug } from '../api/inventory';
import { getFollowUpStats } from '../api/followUp';
import { PhoneOutlined } from '@ant-design/icons';
import useIsMobile from '../hooks/useIsMobile';

const { Header, Sider, Content } = AntLayout;

type MenuItem = Required<AntMenuProps>['items'][number];

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordForm] = Form.useForm();
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const [alertCount, setAlertCount] = useState(0);
  const [followUpCount, setFollowUpCount] = useState(0);

  useEffect(() => {
    if (!hasPermission('inventory:read')) return;

    const checkAlerts = async () => {
      try {
        const res = await listInventoryDrugs({ size: 9999 });
        const body = res as any;
        const drugs: InventoryDrug[] = body.data?.list || [];
        const config = JSON.parse(localStorage.getItem('inventory-alert-config') || '{}');

        const muted: number[] = JSON.parse(localStorage.getItem('inventory-alert-muted') || '[]');
        const count = drugs.filter((d) => {
          if (muted.includes(d.id)) return false;
          const threshold = d.alert_threshold ?? (d.category === 'herb' ? (config.herbThreshold ?? 500) : (config.patentThreshold ?? 10));
          return d.stock <= threshold;
        }).length;

        setAlertCount(count);
      } catch { /* ignore */ }
    };

    checkAlerts();
    const interval = JSON.parse(localStorage.getItem('inventory-alert-config') || '{}').scanInterval ?? 30;
    const timer = setInterval(checkAlerts, interval * 60 * 1000);

    const onAlertChanged = () => checkAlerts();
    const onDataChanged = () => {
      localStorage.removeItem('inventory-alert-muted');
      checkAlerts();
    };
    window.addEventListener('inventory-alert-changed', onAlertChanged);
    window.addEventListener('inventory-data-changed', onDataChanged);

    return () => {
      clearInterval(timer);
      window.removeEventListener('inventory-alert-changed', onAlertChanged);
      window.removeEventListener('inventory-data-changed', onDataChanged);
    };
  }, [hasPermission]);

  useEffect(() => {
    if (!hasPermission('followup:read')) return;

    const checkFollowUps = async () => {
      try {
        const res = await getFollowUpStats();
        const data = (res as any).data;
        setFollowUpCount(data?.overdue_count || 0);
      } catch { /* ignore */ }
    };

    checkFollowUps();
    const interval = setInterval(checkFollowUps, 5 * 60 * 1000);
    const onFollowUpChanged = () => checkFollowUps();
    window.addEventListener('followup-data-changed', onFollowUpChanged);
    return () => {
      clearInterval(interval);
      window.removeEventListener('followup-data-changed', onFollowUpChanged);
    };
  }, [hasPermission]);

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
      {
        key: '/meridians',
        icon: <ApartmentOutlined />,
        label: '经络穴位',
      },
      {
        key: '/pulses',
        icon: <HeartOutlined />,
        label: '脉象',
      },
      {
        key: '/wuyun',
        icon: <CloudOutlined />,
        label: '五运六气',
      },
      {
        key: '/clinical-experience',
        icon: <BookOutlined />,
        label: '临床经验集',
      },
      {
        key: '/solar-terms',
        icon: <CalendarOutlined />,
        label: '节气',
      },
      {
        key: '/yijing',
        icon: <FileTextOutlined />,
        label: '易理',
      },
    ];
    items.push({
      key: '/tcm',
      icon: <ExperimentOutlined />,
      label: '中医药',
      children: tcmChildren,
    });

    const showOps = hasPermission('inventory:read') || hasPermission('followup:read') || hasPermission('statistics:read');
    if (showOps) {
      const totalBadge = alertCount + followUpCount;
      items.push({
        key: '/ops',
        icon: <ShopOutlined />,
        label: totalBadge > 0
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              运营
              <span style={{
                background: '#ff4d4f', color: '#fff', fontSize: 11,
                lineHeight: '16px', minWidth: 16, height: 16,
                borderRadius: 8, padding: '0 4px', textAlign: 'center', fontWeight: 500,
              }}>{totalBadge}</span>
            </span>
          : '运营',
        children: [
          ...(hasPermission('inventory:read') ? [
            {
              key: '/inventory/drugs',
              icon: <MedicineBoxOutlined />,
              label: '库存药物',
            },
            {
              key: '/inventory/alerts',
              icon: <AlertOutlined />,
              label: alertCount > 0
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    库存预警
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff4d4f', boxShadow: '0 0 4px #ff4d4f', flexShrink: 0 }} />
                  </span>
                : '库存预警',
            },
          ] : []),
          ...(hasPermission('followup:read') ? [{
            key: '/follow-ups',
            icon: <PhoneOutlined />,
            label: followUpCount > 0
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  回访
                  <span style={{
                    background: '#ff4d4f', color: '#fff', fontSize: 11,
                    lineHeight: '16px', minWidth: 16, height: 16,
                    borderRadius: 8, padding: '0 4px', textAlign: 'center', fontWeight: 500,
                  }}>{followUpCount}</span>
                </span>
              : '回访',
          }] : []),
          ...(hasPermission('statistics:read') ? [{
            key: '/statistics',
            icon: <BarChartOutlined />,
            label: '统计概览',
          }] : []),
        ],
      });
    }

    const canManageUsers = hasPermission('user:manage') || hasPermission('tenant:user:manage');
    const canManageRoles = hasPermission('role:manage') || hasPermission('tenant:role:manage');
    const canManageTenants = hasPermission('tenant:manage');
    const canManageConfig = hasPermission('user:manage');

    if (canManageUsers || canManageRoles || canManageTenants || canManageConfig) {
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
      if (canManageConfig) {
        settingsChildren.push({
          key: '/settings/config',
          icon: <ToolOutlined />,
          label: '软件配置',
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
  }, [hasPermission, alertCount, followUpCount]);

  // Determine selected keys from current path
  const selectedKeys = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/settings/roles')) return ['/settings/roles'];
    if (path.startsWith('/settings/users')) return ['/settings/users'];
    if (path.startsWith('/settings/tenants')) return ['/settings/tenants'];
    if (path.startsWith('/settings/config')) return ['/settings/config'];
    if (path.startsWith('/patients')) return ['/patients'];
    if (path.startsWith('/oplogs')) return ['/oplogs'];
    if (path.startsWith('/herbs')) return ['/herbs'];
    if (path.startsWith('/formulas')) return ['/formulas'];
    if (path.startsWith('/meridians')) return ['/meridians'];
    if (path.startsWith('/pulses')) return ['/pulses'];
    if (path.startsWith('/wuyun')) return ['/wuyun'];
    if (path.startsWith('/clinical-experience')) return ['/clinical-experience'];
    if (path.startsWith('/solar-terms')) return ['/solar-terms'];
    if (path.startsWith('/yijing')) return ['/yijing'];
    if (path.startsWith('/inventory/drugs')) return ['/inventory/drugs'];
    if (path.startsWith('/inventory/alerts')) return ['/inventory/alerts'];
    if (path.startsWith('/follow-ups')) return ['/follow-ups'];
    if (path.startsWith('/statistics')) return ['/statistics'];
    if (path.startsWith('/records')) return ['/records'];
    return ['/records'];
  }, [location.pathname]);

  const openKeys = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/settings')) return ['/settings'];
    if (path.startsWith('/inventory') || path.startsWith('/follow-ups') || path.startsWith('/statistics')) return ['/ops'];
    if (path.startsWith('/herbs') || path.startsWith('/formulas') || path.startsWith('/meridians') || path.startsWith('/pulses') || path.startsWith('/wuyun') || path.startsWith('/clinical-experience') || path.startsWith('/solar-terms') || path.startsWith('/yijing')) return ['/tcm'];
    return [];
  }, [location.pathname]);

  const handleMenuClick = (info: { key: string }) => {
    navigate(info.key);
    if (isMobile) setDrawerOpen(false);
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

  const siderContent = (
    <>
      <div
        style={{
          height: 32,
          margin: 16,
          color: '#fff',
          fontSize: isMobile ? 18 : collapsed ? 14 : 18,
          fontWeight: 'bold',
          textAlign: 'center',
          lineHeight: '32px',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {!isMobile && collapsed ? '门诊' : '门诊管理系统'}
      </div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={selectedKeys}
        defaultOpenKeys={openKeys}
        items={menuItems}
        onClick={handleMenuClick}
      />
    </>
  );

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      {isMobile ? (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={220}
          styles={{ body: { padding: 0, background: '#001529' }, header: { display: 'none' } }}
        >
          {siderContent}
        </Drawer>
      ) : (
        <Sider
          trigger={null}
          collapsible
          collapsed={collapsed}
          breakpoint="lg"
          onBreakpoint={(broken) => {
            if (broken) setCollapsed(true);
          }}
        >
          {siderContent}
        </Sider>
      )}
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
            icon={isMobile ? <MenuOutlined /> : collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => isMobile ? setDrawerOpen(true) : setCollapsed(!collapsed)}
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
