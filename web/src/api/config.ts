import request from '../utils/request';

export function getConfig() {
  return request.get('/config');
}

export function updateConfig(data: Record<string, string>) {
  return request.put('/config', data);
}
