import request from '../utils/request';

export function listPatients(params: { name?: string; page?: number; size?: number }) {
  return request.get('/patients', { params });
}

export function getPatient(id: number) {
  return request.get(`/patients/${id}`);
}

export function createPatient(data: unknown) {
  return request.post('/patients', data);
}

export function updatePatient(id: number, data: unknown) {
  return request.put(`/patients/${id}`, data);
}

export function deletePatient(id: number) {
  return request.delete(`/patients/${id}`);
}

export async function findPatientPage(id: number, size: number): Promise<number> {
  const res = await request.get(`/patients/${id}/page`, { params: { size } });
  return (res as any).data?.page || 1;
}
