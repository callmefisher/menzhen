import { useState, useMemo, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, theme, Dropdown, Modal, Form, Input, message, Drawer, Popover } from 'antd';
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
  CloudSyncOutlined,
  BookOutlined,
  ShopOutlined,
  AlertOutlined,
  CalendarOutlined,
  FileTextOutlined,
  BarChartOutlined,
  ToolOutlined,
  PhoneOutlined,
  FontSizeOutlined,
  BgColorsOutlined,
  SoundOutlined,
  MobileOutlined,
} from '@ant-design/icons';
import type { MenuProps as AntMenuProps } from 'antd';
import { useAuth } from '../store/auth';
import { useTheme } from '../store/theme';
import { sidebarThemes } from '../theme/sidebarThemes';
import { changePassword } from '../api/auth';
import { listInventoryDrugs } from '../api/inventory';
import type { InventoryDrug } from '../api/inventory';
import { getFollowUpStats } from '../api/followUp';
import { getPendingCount } from '../api/prescriptionNotification';
import { getQueueStats } from '../api/queue';
import useIsMobile from '../hooks/useIsMobile';
import { useWebSocket } from '../hooks/useWebSocket';
import AccessibilityToggle from './AccessibilityToggle';
import { modeLabels } from './AccessibilitySettingsPanel';
import { useAccessibility } from '../store/accessibility';

const { Header, Sider, Content } = AntLayout;

type MenuItem = Required<AntMenuProps>['items'][number];

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordForm] = Form.useForm();
  const { user, logout, hasPermission, isSuperAdmin, queueEnabled, fetchQueueEnabled, appointmentEnabled, fetchAppointmentEnabled, licenseExpired } = useAuth();
  const { themeKey, themeConfig, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { mode: a11yMode, cycleMode } = useAccessibility();
  const {
    token: { borderRadiusLG },
  } = theme.useToken();

  const [alertCount, setAlertCount] = useState(0);
  const [followUpCount, setFollowUpCount] = useState(0);
  const [rxPendingCount, setRxPendingCount] = useState(0);
  const [queueWaitingCount, setQueueWaitingCount] = useState(0);

  // Auto-collapse sidebar in large-font mode, auto-expand back in normal mode
  useEffect(() => {
    if (!isMobile) {
      setCollapsed(a11yMode !== 'normal');
    }
  }, [a11yMode, isMobile]);

  useEffect(() => {
    if (licenseExpired && location.pathname !== '/settings/license' && location.pathname !== '/login' && location.pathname !== '/register') {
      message.error({ content: '软件授权已过期，请联系管理员', key: 'license_expired', duration: 0 });
      // 只有有授权管理权限的用户才跳转到授权页面
      if (hasPermission('license:manage')) {
        navigate('/settings/license', { replace: true });
      }
    }
    if (!licenseExpired) {
      message.destroy('license_expired');
    }
  }, [licenseExpired, hasPermission, location.pathname, navigate]);

  useEffect(() => {
    window.scrollTo(0, 0);
    fetchQueueEnabled();
    fetchAppointmentEnabled();
  }, [fetchQueueEnabled, fetchAppointmentEnabled]);

  useEffect(() => {
    if (!hasPermission('inventory:read')) return;

    const checkAlerts = async () => {
      try {
        const res = await listInventoryDrugs({ size: 9999 });
        const body = res as unknown as { data?: { list?: InventoryDrug[] } };
        const drugs: InventoryDrug[] = body.data?.list ?? [];
        const config = JSON.parse(localStorage.getItem('inventory-alert-config') || '{}');

        const rawMuted = JSON.parse(localStorage.getItem('inventory-alert-muted') || '[]');
        const muted: number[] = Array.isArray(rawMuted) ? rawMuted : [];
        const count = drugs.filter((d) => {
          if (muted.includes(d.id)) return false;
          const threshold = d.alert_threshold ?? (d.category === 'herb' ? (config.herbThreshold ?? 500) : (config.patentThreshold ?? 10));
          return d.stock <= threshold;
        }).length;

        setAlertCount(count);
      } catch { /* ignore */ }
    };

    // Mount: clear muted so login always shows fresh alerts
    localStorage.removeItem('inventory-alert-muted');
    checkAlerts();
    let lastCheck = Date.now();
    const alertConfig = JSON.parse(localStorage.getItem('inventory-alert-config') || '{}');
    const interval = alertConfig.scanInterval ?? 30;
    const intervalMs = interval * 60 * 1000;
    let timer = setInterval(() => {
      localStorage.removeItem('inventory-alert-muted');
      checkAlerts();
      lastCheck = Date.now();
    }, intervalMs);

    // Re-check when page becomes visible after being hidden, then reset interval
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck >= intervalMs) {
        localStorage.removeItem('inventory-alert-muted');
        checkAlerts();
        lastCheck = Date.now();
        clearInterval(timer);
        timer = setInterval(() => {
          localStorage.removeItem('inventory-alert-muted');
          checkAlerts();
          lastCheck = Date.now();
        }, intervalMs);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onAlertChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.count === 'number') {
        setAlertCount(detail.count);
      } else {
        checkAlerts();
      }
    };
    const onDataChanged = () => {
      localStorage.removeItem('inventory-alert-muted');
      checkAlerts();
    };
    window.addEventListener('inventory-alert-changed', onAlertChanged);
    window.addEventListener('inventory-data-changed', onDataChanged);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('inventory-alert-changed', onAlertChanged);
      window.removeEventListener('inventory-data-changed', onDataChanged);
    };
  }, [hasPermission]);

  useEffect(() => {
    if (!hasPermission('followup:read')) return;

    const checkFollowUps = async () => {
      try {
        const res = await getFollowUpStats();
        const body = res as unknown as { data?: { overdue_count?: number } };
        setFollowUpCount(body.data?.overdue_count ?? 0);
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

  // --- Prescription notification badge (rx) ---
  const fetchRxPendingCount = useCallback(async () => {
    try {
      const res = await getPendingCount();
      const body = res as unknown as { data?: { count?: number } };
      setRxPendingCount(typeof body.data?.count === 'number' ? body.data.count : 0);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (user) fetchRxPendingCount();
  }, [fetchRxPendingCount, user]);

  // --- Queue waiting badge ---
  const fetchQueueWaiting = useCallback(async () => {
    if (!hasPermission('queue:read')) return;
    try {
      const res = await getQueueStats();
      const body = res as unknown as { data?: { waiting?: number } };
      setQueueWaitingCount(typeof body.data?.waiting === 'number' ? body.data.waiting : 0);
    } catch { /* ignore */ }
  }, [hasPermission]);

  useEffect(() => {
    if (user) fetchQueueWaiting();
  }, [fetchQueueWaiting, user]);

  useWebSocket('_reconnect', () => { fetchRxPendingCount(); fetchQueueWaiting(); });
  useWebSocket('rx_notify', () => { setRxPendingCount((prev) => prev + 1); });
  useWebSocket('rx_done', (msg) => {
    if (msg.payload?.batch) fetchRxPendingCount();
    else setRxPendingCount((prev) => Math.max(0, prev - 1));
  });
  useWebSocket('queue_update', () => { fetchQueueWaiting(); });
  useWebSocket('queue_clear', () => { setQueueWaitingCount(0); });

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

    const badgeStyle: React.CSSProperties = {
      background: '#ff4d4f', color: '#fff', fontSize: 11,
      lineHeight: '16px', minWidth: 16, height: 16,
      borderRadius: 8, padding: '0 4px', textAlign: 'center', fontWeight: 500,
    };
    const fmtBadge = (n: number) => n > 99 ? '99+' : String(n);

    // Queue menu item
    if (hasPermission('queue:read') && queueEnabled) {
      items.push({
        key: '/queue',
        icon: <SoundOutlined />,
        label: queueWaitingCount > 0
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              排队叫号
              <span style={badgeStyle}>{fmtBadge(queueWaitingCount)}</span>
            </span>
          : '排队叫号',
      });
    }

    // Appointment menu item
    if (hasPermission('appointment:read') && appointmentEnabled) {
      items.push({
        key: '/appointments',
        icon: <CalendarOutlined />,
        label: '预约管理',
      });
    }

    const showOps = hasPermission('inventory:read') || hasPermission('followup:read') || hasPermission('statistics:read');
    if (showOps) {
      const totalBadge = alertCount + followUpCount + rxPendingCount;
      items.push({
        key: '/ops',
        icon: <ShopOutlined />,
        label: totalBadge > 0
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              运营
              <span style={badgeStyle}>{fmtBadge(totalBadge)}</span>
            </span>
          : '运营',
        children: [
          ...(hasPermission('inventory:read') ? [
            {
              key: '/inventory/drugs',
              icon: <MedicineBoxOutlined />,
              label: rxPendingCount > 0
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    库存药物
                    <span style={badgeStyle}>{fmtBadge(rxPendingCount)}</span>
                  </span>
                : '库存药物',
            },
            {
              key: '/inventory/alerts',
              icon: <AlertOutlined />,
              label: alertCount > 0
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    库存预警
                    <span style={badgeStyle}>{fmtBadge(alertCount)}</span>
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
                  <span style={badgeStyle}>{fmtBadge(followUpCount)}</span>
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

    const canManageUsers = hasPermission('user:manage') || hasPermission('tenant:user:manage');
    const canManageRoles = hasPermission('role:manage') || hasPermission('tenant:role:manage');
    const canManageTenants = hasPermission('tenant:manage');
    const canManageConfig = hasPermission('user:manage');

    if (canManageUsers || canManageRoles || canManageTenants || canManageConfig || isSuperAdmin) {
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
          key: '/settings/queue',
          icon: <SoundOutlined />,
          label: '排队设置',
        });
        if (appointmentEnabled) {
          settingsChildren.push({
            key: '/settings/appointment-slots',
            icon: <CalendarOutlined />,
            label: '预约时间段',
          });
        }
        settingsChildren.push({
          key: '/settings/patient-portal',
          icon: <MobileOutlined />,
          label: '患者端管理',
        });
      }
      if (isSuperAdmin) {
        settingsChildren.push({
          key: '/settings/config',
          icon: <ToolOutlined />,
          label: '软件配置',
        });
        settingsChildren.push({
          key: '/settings/backup',
          icon: <CloudSyncOutlined />,
          label: '备份与恢复',
        });
      }
      if (isSuperAdmin) {
        settingsChildren.push({
          key: '/settings/power-admins',
          icon: <TeamOutlined />,
          label: '超级管理员',
        });
      }
      if (isSuperAdmin || hasPermission('license:manage')) {
        settingsChildren.push({
          key: '/settings/license',
          icon: <KeyOutlined />,
          label: '授权',
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
  }, [hasPermission, isSuperAdmin, alertCount, followUpCount, rxPendingCount, queueWaitingCount, queueEnabled, appointmentEnabled]);

  // Determine selected keys from current path
  const selectedKeys = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/settings/roles')) return ['/settings/roles'];
    if (path.startsWith('/settings/users')) return ['/settings/users'];
    if (path.startsWith('/settings/tenants')) return ['/settings/tenants'];
    if (path.startsWith('/settings/config')) return ['/settings/config'];
    if (path.startsWith('/settings/backup')) return ['/settings/backup'];
    if (path.startsWith('/settings/queue')) return ['/settings/queue'];
    if (path.startsWith('/settings/appointment-slots')) return ['/settings/appointment-slots'];
    if (path.startsWith('/settings/patient-portal')) return ['/settings/patient-portal'];
    if (path.startsWith('/settings/power-admins')) return ['/settings/power-admins'];
    if (path.startsWith('/patients')) return ['/patients'];
    if (path.startsWith('/queue')) return ['/queue'];
    if (path.startsWith('/appointments')) return ['/appointments'];
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
    ...(isMobile ? [
      {
        key: 'font-size',
        icon: <FontSizeOutlined />,
        label: `字号：${modeLabels[a11yMode]}`,
        onClick: cycleMode,
      },
      {
        key: 'theme-picker',
        icon: <BgColorsOutlined />,
        label: '主题色',
        children: Object.values(sidebarThemes).map((t) => ({
          key: `theme-${t.key}`,
          label: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 16, height: 16, borderRadius: '50%',
                background: t.sidebarBg, display: 'inline-block',
                border: themeKey === t.key ? '2px solid #52C41A' : '2px solid transparent',
              }} />
              {t.label}
              {themeKey === t.key && <span style={{ color: '#52C41A', fontSize: 12 }}>✓</span>}
            </span>
          ),
          onClick: () => setTheme(t.key),
        })),
      },
      { type: 'divider' as const },
    ] : []),
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
          color: themeConfig.titleColor,
          fontSize: isMobile ? 18 : collapsed ? 14 : 18,
          fontWeight: 'bold',
          textAlign: 'center',
          lineHeight: '32px',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          letterSpacing: 2,
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
        style={{ background: themeConfig.sidebarBg, borderRight: 0 }}
      />
    </>
  );

  const themePickerContent = (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
      {Object.values(sidebarThemes).map((t) => {
        const isActive = themeKey === t.key;
        return (
          <div key={t.key} onClick={() => setTheme(t.key)} style={{ textAlign: 'center', cursor: 'pointer' }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: t.sidebarBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: isActive ? '3px solid #52C41A' : '3px solid transparent',
              boxShadow: isActive ? '0 0 0 2px rgba(82,196,26,0.2)' : '0 1px 4px rgba(0,0,0,0.1)',
              transition: 'all 0.2s',
              margin: '0 auto 4px',
            }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', background: t.titleColor, display: 'block' }} />
            </div>
            <span style={{ fontSize: 11, color: isActive ? '#52C41A' : '#999', fontWeight: isActive ? 600 : 400 }}>{t.label}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <AntLayout style={{ minHeight: '100vh', background: '#FAFAF5' }}>
      {isMobile ? (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={220}
          styles={{ body: { padding: 0, background: themeConfig.sidebarBg, overflowY: 'auto' }, header: { display: 'none' } }}
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
          style={{ background: themeConfig.sidebarBg, height: '100vh', position: 'sticky', top: 0, overflow: 'auto' }}
        >
          {siderContent}
        </Sider>
      )}
      <AntLayout style={isMobile ? { paddingTop: 64 } : undefined}>
        <Header
          style={{
            padding: '0 16px',
            background: themeConfig.headerBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${themeConfig.headerBorder}`,
            ...(isMobile ? { position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, height: 64 } : {}),
          }}
        >
          <Button
            type="text"
            icon={isMobile ? <MenuOutlined /> : collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => isMobile ? setDrawerOpen(true) : setCollapsed(!collapsed)}
            style={{ fontSize: 16, width: 48, height: 48 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!isMobile && <AccessibilityToggle />}
            {!isMobile && <Popover content={themePickerContent} trigger="click" placement="bottomRight">
              <div style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: themeConfig.sidebarBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
              }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: themeConfig.titleColor, display: 'block' }} />
              </div>
            </Popover>}
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <Button type="text" icon={
                (user?.real_name || user?.username) ? (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: themeConfig.titleColor || '#1890ff',
                    color: '#fff',
                    fontSize: 18,
                    fontWeight: 900,
                    fontFamily: "'Noto Sans SC', 'PingFang SC', sans-serif",
                    textShadow: '0 0 1px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.2)',
                    WebkitFontSmoothing: 'antialiased',
                  }}>
                    {(user?.real_name || user?.username || '').charAt(0)}
                  </span>
                ) : <UserOutlined />
              }>
                {user?.real_name || user?.username || '用户'}
              </Button>
            </Dropdown>
          </div>
        </Header>
        <Content
          style={{
            margin: '16px',
            padding: 24,
            background: '#FFFEF9',
            borderRadius: borderRadiusLG,
            minHeight: 280,
            boxShadow: '0 2px 8px rgba(44, 24, 16, 0.06)',
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
