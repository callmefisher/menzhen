import request from '../utils/request';

export interface DiskStatus {
  total: number;
  used: number;
  free: number;
  used_pct: number;
  mysql_used: number;
  minio_used: number;
  backup_used: number;
  collected_at: string;
  interval: number; // seconds
}

export interface DiskTask {
  task_id: string;
  type: string;
  status: 'running' | 'success' | 'failed' | 'aborted';
  step: number;
  total: number;
  output: string;
  start_at: string;
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export const getDiskStatus = () =>
  request.get<{ code: number; data: DiskStatus }>('/disk/status');

export const setDiskInterval = (interval: number) =>
  request.put<{ code: number }>('/disk/interval', { interval });

export const browseFS = (path: string) =>
  request.get<{ code: number; data: DirEntry[] }>('/disk/fs', { params: { path } });

export const startMigrate = (target: 'mysql' | 'minio', newPath: string) =>
  request.post<{ code: number; data: DiskTask }>('/disk/migrate', { target, new_path: newPath });

export const getMigrateStatus = (taskId: string) =>
  request.get<{ code: number; data: DiskTask }>('/disk/migrate/status', { params: { task_id: taskId } });

export const changeBackupDir = (newPath: string) =>
  request.post<{ code: number; data: DiskTask }>('/disk/backup-dir', { new_path: newPath });

export const getBackupDirStatus = (taskId: string) =>
  request.get<{ code: number; data: DiskTask }>('/disk/backup-dir/status', { params: { task_id: taskId } });
