import request from '../utils/request';

export interface DBCleanupResult {
  orphan_prescriptions: number;
  orphan_items: number;
  orphan_billings: number;
  orphan_user_roles: number;
  orphan_role_permissions: number;
  soft_deleted: Record<string, number>;
  cleaned?: Record<string, number>;
}

/** Scan or cleanup orphan data in the database. */
export function cleanupOrphanData(dryRun: boolean = true) {
  return request.post<DBCleanupResult>(`/db/cleanup?dry_run=${dryRun}`);
}
