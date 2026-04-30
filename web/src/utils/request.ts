import axios from 'axios';
import { message } from 'antd';

export const LICENSE_EXPIRED_EVENT = 'license_expired_change';

export function emitLicenseExpired(expired: boolean) {
  window.dispatchEvent(new CustomEvent(LICENSE_EXPIRED_EVENT, { detail: { expired } }));
}

const PERMISSION_NAME_MAP: Record<string, string> = {
  'patient:create': '创建患者',
  'patient:read': '查看患者',
  'patient:update': '修改患者',
  'patient:delete': '删除患者',
  'record:create': '创建诊疗记录',
  'record:read': '查看诊疗记录',
  'record:update': '修改诊疗记录',
  'record:delete': '删除诊疗记录',
  'oplog:read': '查看操作日志',
  'oplog:delete': '删除操作日志',
  'user:manage': '用户管理',
  'role:manage': '角色管理',
  'herb:read': '查询中药',
  'formula:read': '查询方剂',
  'prescription:create': '开方',
  'prescription:read': '查看处方',
  'tenant:manage': '诊所管理',
  'license:manage': '授权管理',
  'power_admin:manage': '超级管理员管理',
  'inventory:create': '新增库存',
  'inventory:read': '查看库存',
  'inventory:update': '修改库存',
  'inventory:delete': '删除库存',
  'billing:create': '收费',
  'billing:read': '查看收费',
  'tenant:user:manage': '诊所用户管理',
  'tenant:role:manage': '诊所角色管理',
  'followup:create': '新增回访',
  'followup:read': '查看回访',
  'followup:update': '编辑回访',
  'followup:delete': '删除回访',
  'statistics:read': '统计数据',
  'queue:read': '查看排队',
  'queue:create': '取号',
  'queue:update': '叫号/完成',
  'queue:clear': '清空排队',
  'appointment:create': '创建预约',
  'appointment:read': '查看预约',
  'appointment:update': '修改预约',
  'appointment:delete': '删除预约',
  'appointment:checkin': '预约签到',
};

const request = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
});

// Request interceptor: attach JWT token
request.interceptors.request.use((config) => {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: unified error handling
let isRefreshing = false;

request.interceptors.response.use(
  (response) => {
    const licenseActive = response.headers['x-license-active'];
    if (licenseActive === 'true') {
      emitLicenseExpired(false);
    } else if (licenseActive === 'false') {
      emitLicenseExpired(true);
    }
    return response.data;
  },
  async (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
      // 登录页的 401 只显示错误信息，不跳转
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }

    // 409 token_refresh_required: auto-refresh token and reload
    if (error.response?.status === 409 && error.response?.data?.message === 'token_refresh_required') {
      if (!isRefreshing) {
        isRefreshing = true;
        try {
          const { refreshToken } = await import('../api/auth');
          const res = await refreshToken() as { data: { token: string } };
          const newToken = res.data.token;
          if (localStorage.getItem('token')) {
            localStorage.setItem('token', newToken);
          } else {
            sessionStorage.setItem('token', newToken);
          }
          window.location.reload();
        } catch {
          localStorage.removeItem('token');
          sessionStorage.removeItem('token');
          window.location.href = '/login';
        } finally {
          isRefreshing = false;
        }
      }
      return Promise.reject(error);
    }

    const ERROR_MESSAGE_MAP: Record<string, string> = {
      'tenant name already exists': '诊所名称已存在',
      'tenant code already exists': '诊所编码已存在',
    };

    const data = error.response?.data;
    let msg = ERROR_MESSAGE_MAP[data?.message] || data?.message || '请求失败';

    // 403 tenant_disabled: clear token and redirect to login
    if (error.response?.status === 403 && data?.message === 'tenant_disabled') {
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
      message.error('该诊所已被禁用，请联系管理员');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    // 403 license_required: block all operations except license page
    if (error.response?.status === 403 && data?.message === 'license_required') {
      emitLicenseExpired(true);
      if (window.location.pathname !== '/settings/license' && window.location.pathname !== '/login') {
        message.error({ content: '软件授权已过期，请联系管理员', key: 'license_expired', duration: 0 });
        setTimeout(() => {
          window.location.href = '/settings/license';
        }, 1500);
      }
      return Promise.reject(error);
    }

    // Show missing permissions for 403 errors
    if (error.response?.status === 403 && data?.required_permissions) {
      const perms = (data.required_permissions as string[])
        .map((code: string) => PERMISSION_NAME_MAP[code] || code)
        .join('、');
      msg = `没有操作权限，需要以下权限：${perms}`;
    }

    message.error(msg);
    return Promise.reject(error);
  }
);

export default request;
