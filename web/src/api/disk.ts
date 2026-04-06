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

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
  created_at: string;
}

export const getDiskStatus = () =>
  request.get<DiskStatus>('/disk/status');

export const setDiskInterval = (interval: number) =>
  request.put<void>('/disk/interval', { interval });

export const listVolumes = () =>
  request.get<DockerVolume[]>('/disk/volumes');

export const startMigrate = (target: 'mysql' | 'minio', newDest: string) =>
  request.post<DiskTask>('/disk/migrate', { target, new_path: newDest });

export const getMigrateStatus = (taskId: string) =>
  request.get<DiskTask>('/disk/migrate/status', { params: { task_id: taskId } });

export const changeBackupDir = (newDest: string) =>
  request.post<DiskTask>('/disk/backup-dir', { new_path: newDest });

export const getBackupDirStatus = (taskId: string) =>
  request.get<DiskTask>('/disk/backup-dir/status', { params: { task_id: taskId } });
