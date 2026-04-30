import request from '../utils/request';

export function getIdentity() {
  return request.get('/licenses/identity');
}

export function updateIdentity(data: { site_id: string }) {
  return request.put('/licenses/identity', data);
}

export function getSiteLicense(tenantId?: number) {
  return request.get('/licenses/site', { params: tenantId ? { tenant_id: tenantId } : {} });
}

export function listAllLicenses(search?: string) {
  return request.get('/licenses', { params: search ? { search } : {} });
}

export function createLicense(data: {
  site_id: string;
  machine_id: string;
  method: string;
  duration?: number;
  auth_date?: string;
  features?: string[];
  amount?: number;
  remark?: string;
  license_token?: string;
}) {
  return request.post('/licenses', data);
}

export function updateLicense(id: number, data: {
  site_id?: string;
  machine_id?: string;
  method?: string;
  duration?: number;
  auth_date?: string;
  features?: string[];
  amount?: number;
  remark?: string;
  license_token?: string;
}) {
  return request.put(`/licenses/${id}`, data);
}

export function getLicense(id: number) {
  return request.get(`/licenses/${id}`);
}

export function deleteLicense(id: number) {
  return request.delete(`/licenses/${id}`);
}

export function listTenantLicenses(tenantId: number) {
  return request.get(`/licenses/tenant/${tenantId}`);
}

export function getLicenseStats(startDate?: string, endDate?: string) {
  return request.get('/licenses/stats', { params: { start_date: startDate, end_date: endDate } });
}

export function getKeys() {
  return request.get('/licenses/keys');
}

export function verifyLicenseToken(token: string) {
  return request.post('/licenses/verify', { token });
}
