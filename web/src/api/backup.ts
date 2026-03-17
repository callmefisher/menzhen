import request from '../utils/request';

export interface BackupFileInfo {
  filename: string;
  key?: string;
  size: number;
  modified: number;
}

export interface BackupFileList {
  mysql: BackupFileInfo[];
  minio: BackupFileInfo[];
}

export interface TaskResult {
  task_id: string;
}

export interface TaskStatus {
  task_id: string;
  type: string;
  status: 'running' | 'success' | 'failed';
  output: string;
  start_at: string;
}

/** 检测 Docker 是否可用 */
export function getDockerStatus() {
  return request.get<{ available: boolean }>('/backup/docker-status');
}

/** 触发备份 */
export function triggerBackup(type: 'mysql' | 'minio' | 'full') {
  return request.post<TaskResult>('/backup/trigger', { type });
}

/** 查询备份任务状态 */
export function getBackupStatus(taskId: string) {
  return request.get<TaskStatus>(`/backup/status/${taskId}`);
}

/** 列出本地备份文件 */
export function listLocalFiles() {
  return request.get<BackupFileList>('/backup/list/local');
}

/** 列出云端备份文件 */
export function listCloudFiles() {
  return request.get<BackupFileList>('/backup/list/cloud');
}

/** 触发恢复 */
export function triggerRestore(data: {
  source: 'local' | 'cloud';
  mysql_file?: string;
  minio_file?: string;
}) {
  return request.post<TaskResult>('/restore/trigger', data);
}

/** 查询恢复任务状态 */
export function getRestoreStatus(taskId: string) {
  return request.get<TaskStatus>(`/restore/status/${taskId}`);
}
