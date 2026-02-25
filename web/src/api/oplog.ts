import request from '../utils/request';

export interface OpLogListParams {
  name?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  size?: number;
}

export interface OpLogItem {
  id: number;
  user_name: string;
  action: string;
  resource_type: string;
  resource_id: number;
  old_data: any;
  new_data: any;
  created_at: string;
}

export function listOpLogs(params: OpLogListParams) {
  return request.get('/oplogs', { params });
}

export function deleteOpLog(id: number) {
  return request.delete(`/oplogs/${id}`);
}

export function batchDeleteOpLogs(ids: number[]) {
  return request.post('/oplogs/batch-delete', { ids });
}
