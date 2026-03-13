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
import { listHerbs, getHerb, deleteHerb, listHerbCategories, updateHerb, aiRefreshHerb } from '../herb';

describe('herb API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listHerbs calls GET /herbs with params', async () => {
    const params = { name: 'huang', category: 'tonify', page: 1, size: 20 };
    await listHerbs(params);
    expect(request.get).toHaveBeenCalledWith('/herbs', { params });
  });

  it('getHerb calls GET /herbs/:id', async () => {
    await getHerb(3);
    expect(request.get).toHaveBeenCalledWith('/herbs/3');
  });

  it('deleteHerb calls DELETE /herbs/:id', async () => {
    await deleteHerb(3);
    expect(request.delete).toHaveBeenCalledWith('/herbs/3');
  });

  it('listHerbCategories calls GET /herbs/categories', async () => {
    await listHerbCategories();
    expect(request.get).toHaveBeenCalledWith('/herbs/categories');
  });

  it('updateHerb calls PUT /herbs/:id with data', async () => {
    const data = { name: 'Updated Herb', category: 'tonify' };
    await updateHerb(3, data);
    expect(request.put).toHaveBeenCalledWith('/herbs/3', data);
  });

  it('aiRefreshHerb calls POST /herbs/:id/ai-refresh', async () => {
    await aiRefreshHerb(3);
    expect(request.post).toHaveBeenCalledWith('/herbs/3/ai-refresh');
  });
});
