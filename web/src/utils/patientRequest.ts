import axios from 'axios';
import { message } from 'antd';

const patientRequest = axios.create({
  baseURL: '/api/v1/patient',
  timeout: 30000,
});

// Attach patient JWT (stored under 'patient_token').
patientRequest.interceptors.request.use((config) => {
  const token = localStorage.getItem('patient_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

patientRequest.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('patient_token');
      if (!window.location.pathname.startsWith('/patient/login')) {
        window.location.href = '/patient/login';
      }
      return Promise.reject(error);
    }
    const msg = error.response?.data?.message || '请求失败';
    message.error(msg);
    return Promise.reject(error);
  }
);

export default patientRequest;
