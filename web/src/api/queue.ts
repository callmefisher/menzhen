import request from '../utils/request';

export interface QueueEntry {
  id: number;
  tenant_id: number;
  patient_id?: number;
  patient_name: string;
  doctor_id: number;
  doctor_name: string;
  room: string;
  seq_number: number;
  status: 'waiting' | 'ready' | 'seeing' | 'done' | 'missed';
  booked_time?: string;
  arrival_time?: string;
  called_at?: string;
  completed_at?: string;
  source: 'walk_in' | 'appointment';
  queue_date: string;
  created_at: string;
}

export interface QueueStats {
  waiting: number;
  seeing: number;
  done: number;
  missed: number;
}

export const listQueue = (doctorId?: number) =>
  request.get('/queue', { params: { doctor_id: doctorId } });

export const takeNumber = (data: { patient_name: string; doctor_id: number; doctor_name: string; room: string }) =>
  request.post('/queue/take', data);

export const callNumber = (id: number) =>
  request.post(`/queue/${id}/call`);

export const completeVisit = (id: number) =>
  request.post(`/queue/${id}/complete`);

export const clearQueue = () =>
  request.post('/queue/clear');

export const getQueueStats = () =>
  request.get('/queue/stats');
