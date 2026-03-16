import request from '../utils/request';

export interface CleanupResult {
  total_files: number;
  referenced_count: number;
  orphan_count: number;
  orphan_files: string[];
  deleted_files?: string[];
  failed_files?: string[];
}

/** Scan or cleanup orphan files in MinIO storage. */
export function cleanupOrphanFiles(dryRun: boolean = true) {
  return request.post<CleanupResult>(`/storage/cleanup?dry_run=${dryRun}`);
}
