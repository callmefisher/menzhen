import request from '../utils/request';

export function login(data: { username: string; password: string }) {
  return request.post('/auth/login', data);
}

export function register(data: {
  tenant_code: string;
  username: string;
  password: string;
  real_name: string;
  phone: string;
}) {
  return request.post('/auth/register', data);
}

export function getMe() {
  return request.get('/auth/me');
}

export function logout() {
  return request.post('/auth/logout');
}
