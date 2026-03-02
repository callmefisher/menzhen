import axios from 'axios';
import { message } from 'antd';

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
  'user:manage': '用户管理',
  'role:manage': '角色管理',
  'herb:read': '查询中药',
  'formula:read': '查询方剂',
  'prescription:create': '开方',
  'prescription:read': '查看处方',
  'tenant:manage': '诊所管理',
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
request.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
      // 登录页的 401 只显示错误信息，不跳转
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }

    const data = error.response?.data;
    let msg = data?.message || '请求失败';

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
