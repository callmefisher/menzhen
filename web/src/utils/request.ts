import axios from 'axios';
import { message } from 'antd';

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
      window.location.href = '/login';
    }
    const msg = error.response?.data?.message || '请求失败';
    message.error(msg);
    return Promise.reject(error);
  }
);

export default request;
