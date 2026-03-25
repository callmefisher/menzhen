import request from '../utils/request';

export interface QueueDoctor {
  id: number;
  tenant_id: number;
  user_id: number;
  user_name: string;
  room: string;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export const listQueueDoctors = () =>
  request.get('/queue-doctors');

export const createQueueDoctor = (data: { user_id: number; room: string; enabled?: boolean }) =>
  request.post('/queue-doctors', data);

export const updateQueueDoctor = (id: number, data: { room: string; enabled: boolean }) =>
  request.put(`/queue-doctors/${id}`, data);

export const deleteQueueDoctor = (id: number) =>
  request.delete(`/queue-doctors/${id}`);

export const updateQueueDoctorSort = (orders: { id: number; sort_order: number }[]) =>
  request.put('/queue-doctors/sort', { orders });

export const getQueueEnabled = () =>
  request.get('/tenant/queue-enabled');

export const setQueueEnabled = (enabled: boolean) =>
  request.put('/tenant/queue-enabled', { enabled });
