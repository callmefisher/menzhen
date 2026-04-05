import request from '../utils/request';

export interface TenantTableCount {
  tenant_id: number;
  tenant_name: string;
  counts: Record<string, number>;
  total_rows: number;
}

export interface MigrateParseResult {
  tenants: TenantTableCount[];
}

export type MigrateTaskStatus =
  | 'parsing'
  | 'parsed'
  | 'running'
  | 'success'
  | 'failed';

export interface MigrateTask {
  task_id: string;
  status: MigrateTaskStatus;
  output: string;
  parse_result?: MigrateParseResult;
  file_name?: string;
  start_at: string;
}

export interface BackupFileItem {
  filename: string;
  size: number;
  modified: number;
}

/** 上传 SQL 文件并开始解析，返回 task_id */
export function uploadMigrateFile(file: File) {
  const form = new FormData();
  form.append('file', file);
  return request.post<{ task_id: string; file_name: string }>(
    '/tenant-migrate/upload',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 5 * 60 * 1000 },
  );
}

/** 从已有备份文件列表选择一个文件开始解析，返回 task_id */
export function parseMigrateFromBackup(backupFile: string) {
  return request.post<{ task_id: string; file_name: string }>(
    '/tenant-migrate/parse',
    { backup_file: backupFile },
  );
}

/** 查询解析/执行任务状态 */
export function getMigrateStatus(taskId: string) {
  return request.get<MigrateTask>(`/tenant-migrate/status/${taskId}`);
}

/** 执行诊所数据迁移 */
export function executeMigrate(params: {
  task_id: string;
  source_tenant_id: number;
  target_tenant_id: number;
  confirm_code: string;
  force?: boolean;
}) {
  return request.post<{ task_id: string }>('/tenant-migrate/execute', params);
}

/** 列出本地可用的 SQL 备份文件 */
export function listMigrateBackupFiles() {
  return request.get<{ files: BackupFileItem[] }>('/tenant-migrate/backup-files');
}
