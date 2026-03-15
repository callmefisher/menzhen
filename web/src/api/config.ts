import request from '../utils/request';

export function getConfig() {
  return request.get('/config');
}

export function updateConfig(data: Record<string, string>) {
  return request.put('/config', data);
}

export function restartService() {
  return request.post('/config/restart');
}
