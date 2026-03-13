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
import {
  listInventoryDrugs,
  createInventoryDrug,
  updateInventoryDrug,
  deleteInventoryDrug,
  stockInDrug,
  batchStockIn,
} from '../inventory';

describe('inventory API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listInventoryDrugs calls GET /inventory/drugs with params', async () => {
    const params = { name: 'huang', category: 'herb', page: 1, size: 20 };
    await listInventoryDrugs(params);
    expect(request.get).toHaveBeenCalledWith('/inventory/drugs', { params });
  });

  it('createInventoryDrug calls POST /inventory/drugs with data', async () => {
    const data = {
      name: 'Huang Qi',
      category: 'herb' as const,
      stock: 100,
      purchase_price: 50,
      selling_price: 80,
      alert_threshold: 10,
    };
    await createInventoryDrug(data);
    expect(request.post).toHaveBeenCalledWith('/inventory/drugs', data);
  });

  it('updateInventoryDrug calls PUT /inventory/drugs/:id with data', async () => {
    const data = { stock: 200, selling_price: 90 };
    await updateInventoryDrug(4, data);
    expect(request.put).toHaveBeenCalledWith('/inventory/drugs/4', data);
  });

  it('deleteInventoryDrug calls DELETE /inventory/drugs/:id', async () => {
    await deleteInventoryDrug(4);
    expect(request.delete).toHaveBeenCalledWith('/inventory/drugs/4');
  });

  it('stockInDrug calls POST /inventory/drugs/:id/stock-in with data', async () => {
    const data = { quantity: 50, purchase_price: 45, selling_price: 75 };
    await stockInDrug(4, data);
    expect(request.post).toHaveBeenCalledWith('/inventory/drugs/4/stock-in', data);
  });

  it('batchStockIn calls POST /inventory/drugs/batch-stock-in with data', async () => {
    const data = {
      items: [{ name: 'Huang Qi', quantity: 100, purchase_price: 50, selling_price: 80 }],
      alert_threshold: 10,
    };
    await batchStockIn(data);
    expect(request.post).toHaveBeenCalledWith('/inventory/drugs/batch-stock-in', data);
  });
});
