import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/request', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

import request from '../../utils/request';
import { listOpLogs, deleteOpLog, batchDeleteOpLogs } from '../oplog';

describe('oplog API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listOpLogs calls GET /oplogs with params', async () => {
    const params = { name: 'admin', start_date: '2026-01-01', end_date: '2026-01-31', page: 1, size: 20 };
    await listOpLogs(params);
    expect(request.get).toHaveBeenCalledWith('/oplogs', { params });
  });

  it('deleteOpLog calls DELETE /oplogs/:id', async () => {
    await deleteOpLog(12);
    expect(request.delete).toHaveBeenCalledWith('/oplogs/12');
  });

  it('batchDeleteOpLogs calls POST /oplogs/batch-delete with ids', async () => {
    await batchDeleteOpLogs([1, 2, 3]);
    expect(request.post).toHaveBeenCalledWith('/oplogs/batch-delete', { ids: [1, 2, 3] });
  });
});
