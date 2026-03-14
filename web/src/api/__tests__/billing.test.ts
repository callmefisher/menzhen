import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/request', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

import request from '../../utils/request';
import {
  getPrescriptionBilling,
  createPrescriptionBilling,
  deductStockAndBill,
  listRecordBillings,
} from '../billing';

describe('billing API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getPrescriptionBilling calls GET /prescriptions/:id/billing', async () => {
    await getPrescriptionBilling(5);
    expect(request.get).toHaveBeenCalledWith('/prescriptions/5/billing');
  });

  it('createPrescriptionBilling calls POST /prescriptions/:id/billing', async () => {
    const data = { consultation_fee: 100, actual_paid: 300 };
    await createPrescriptionBilling(5, data);
    expect(request.post).toHaveBeenCalledWith('/prescriptions/5/billing', data);
  });

  it('deductStockAndBill calls POST /prescriptions/:id/billing/deduct-stock', async () => {
    const data = { consultation_fee: 100, actual_paid: 300 };
    await deductStockAndBill(5, data);
    expect(request.post).toHaveBeenCalledWith('/prescriptions/5/billing/deduct-stock', data);
  });

  it('listRecordBillings calls GET /records/:id/billings', async () => {
    await listRecordBillings(10);
    expect(request.get).toHaveBeenCalledWith('/records/10/billings');
  });
});
