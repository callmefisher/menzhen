import request from '../utils/request';

export function getVersion() {
  return request.get('/version');
}
