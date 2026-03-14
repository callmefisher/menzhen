import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Drawer,
  Table,
  InputNumber,
  Button,
  Space,
  Spin,
  message,
  Tag,
  Popconfirm,
  Descriptions,
} from 'antd';
import { PrinterOutlined, DollarOutlined } from '@ant-design/icons';
import type { BillingDetail } from '../api/billing';
import {
  getPrescriptionBilling,
  createPrescriptionBilling,
  deductStockAndBill,
} from '../api/billing';
import BillingPrint from './BillingPrint';
import type { BillingPrintHandle } from './BillingPrint';
import useIsMobile from '../hooks/useIsMobile';

interface BillingDrawerProps {
  open: boolean;
  prescriptionId: number;
  patientName?: string;
  patientAge?: number;
  doctorName?: string;
  onClose: () => void;
}

export default function BillingDrawer({
  open,
  prescriptionId,
  patientName,
  patientAge,
  doctorName,
  onClose,
}: BillingDrawerProps) {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<BillingDetail | null>(null);
  const [consultationFee, setConsultationFee] = useState(100);
  const [actualPaid, setActualPaid] = useState(0);
  const printRef = useRef<BillingPrintHandle>(null);

  const loadDetail = useCallback(async () => {
    if (!prescriptionId) return;
    setLoading(true);
    try {
      const res = await getPrescriptionBilling(prescriptionId);
      const d = res.data.data as BillingDetail;
      setDetail(d);
      setConsultationFee(d.consultation_fee);
      setActualPaid(d.actual_paid);
    } catch {
      message.error('加载收费明细失败');
    } finally {
      setLoading(false);
    }
  }, [prescriptionId]);

  useEffect(() => {
    if (open) loadDetail();
  }, [open, loadDetail]);

  const drugCostTotal = detail?.drug_cost_total ?? 0;
  const totalAmount = drugCostTotal + consultationFee;

  const handleSave = async () => {
    setSaving(true);
    try {
      await createPrescriptionBilling(prescriptionId, {
        consultation_fee: consultationFee,
        actual_paid: actualPaid,
      });
      message.success('收费记录已保存');
      await loadDetail();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handlePrintOnly = async () => {
    setSaving(true);
    try {
      await createPrescriptionBilling(prescriptionId, {
        consultation_fee: consultationFee,
        actual_paid: actualPaid,
      });
      await loadDetail();
      setTimeout(() => printRef.current?.print(), 100);
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDeductAndPrint = async () => {
    setSaving(true);
    try {
      await deductStockAndBill(prescriptionId, {
        consultation_fee: consultationFee,
        actual_paid: actualPaid,
      });
      message.success('库存已扣除，收费记录已保存');
      await loadDetail();
      setTimeout(() => printRef.current?.print(), 100);
    } catch (err: unknown) {
      const errMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(errMsg || '扣除库存失败');
    } finally {
      setSaving(false);
    }
  };

  const printDetail: BillingDetail | null = detail
    ? { ...detail, consultation_fee: consultationFee, actual_paid: actualPaid, total_amount: totalAmount }
    : null;

  const herbColumns = [
    { title: '药名', dataIndex: 'herb_name', key: 'herb_name',
      render: (name: string, record: { in_stock: boolean }) => (
        <span>{name} {!record.in_stock && <Tag color="orange">无库存</Tag>}</span>
      ),
    },
    { title: '用量', dataIndex: 'dosage', key: 'dosage', width: 80 },
    { title: '单价', dataIndex: 'unit_price', key: 'unit_price', width: 80, align: 'right' as const,
      render: (v: number, record: { in_stock: boolean }) => record.in_stock ? `¥${v.toFixed(2)}` : '-',
    },
    { title: '小计', dataIndex: 'item_cost', key: 'item_cost', width: 100, align: 'right' as const,
      render: (v: number) => `¥${v.toFixed(2)}`,
    },
  ];

  return (
    <Drawer
      title={<Space><DollarOutlined />收费明细{detail?.formula_name ? ` - ${detail.formula_name}` : ''}</Space>}
      open={open}
      onClose={onClose}
      width={isMobile ? '100%' : 640}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={handleSave} loading={saving}>
            保存
          </Button>
          <Button icon={<PrinterOutlined />} onClick={handlePrintOnly} loading={saving}>
            仅打印收费
          </Button>
          <Popconfirm
            title="确认扣除库存？"
            description="扣除后不可撤销"
            onConfirm={handleDeductAndPrint}
            okText="确认"
            cancelText="取消"
            disabled={detail?.stock_deducted}
          >
            <Button
              type="primary"
              icon={<DollarOutlined />}
              loading={saving}
              disabled={detail?.stock_deducted}
            >
              {detail?.stock_deducted ? '库存已扣除' : '扣除库存并打印'}
            </Button>
          </Popconfirm>
        </div>
      }
    >
      <Spin spinning={loading}>
        {detail && (
          <>
            <Descriptions column={isMobile ? 1 : 2} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="方剂">{detail.formula_name || '自定义处方'}</Descriptions.Item>
              <Descriptions.Item label="付数">{detail.total_doses} 付</Descriptions.Item>
            </Descriptions>

            {(detail.items || []).filter((i) => i.category === 'herb').length > 0 && (
              <>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>中药明细</div>
                <Table
                  dataSource={(detail.items || []).filter((i) => i.category === 'herb')}
                  columns={herbColumns}
                  rowKey="herb_name"
                  pagination={false}
                  size="small"
                  bordered
                />
              </>
            )}

            {(detail.items || []).filter((i) => i.category === 'patent').length > 0 && (
              <>
                <div style={{ fontWeight: 500, marginTop: 16, marginBottom: 8 }}>中成药明细</div>
                <Table
                  dataSource={(detail.items || []).filter((i) => i.category === 'patent')}
                  columns={[
                    { title: '药名', dataIndex: 'herb_name', key: 'herb_name',
                      render: (name: string, record: { in_stock: boolean }) => (
                        <span>{name} {!record.in_stock && <Tag color="orange">无库存</Tag>}</span>
                      ),
                    },
                    { title: '用量', dataIndex: 'dosage', key: 'dosage', width: 80 },
                    { title: '单价(元/盒)', dataIndex: 'unit_price', key: 'unit_price', width: 100, align: 'right' as const,
                      render: (v: number, record: { in_stock: boolean }) => record.in_stock ? `¥${v.toFixed(2)}` : '-',
                    },
                    { title: '小计', dataIndex: 'item_cost', key: 'item_cost', width: 100, align: 'right' as const,
                      render: (v: number) => `¥${v.toFixed(2)}`,
                    },
                  ]}
                  rowKey="herb_name"
                  pagination={false}
                  size="small"
                  bordered
                />
              </>
            )}

            <div style={{
              marginTop: 16, padding: 16, background: '#fafafa',
              borderRadius: 8, border: '1px solid #f0f0f0',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span>药费合计：</span>
                <span style={{ fontWeight: 500 }}>¥{drugCostTotal.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span>诊疗费：</span>
                <InputNumber
                  value={consultationFee}
                  onChange={(v) => setConsultationFee(v ?? 0)}
                  min={0}
                  precision={2}
                  prefix="¥"
                  size="small"
                  style={{ width: 120 }}
                />
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                paddingTop: 8, borderTop: '1px solid #e8e8e8',
                fontSize: 16, fontWeight: 'bold',
              }}>
                <span>应收：</span>
                <span>¥{totalAmount.toFixed(2)}</span>
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginTop: 8, fontSize: 16, fontWeight: 'bold',
              }}>
                <span>实收：</span>
                <InputNumber
                  value={actualPaid}
                  onChange={(v) => setActualPaid(v ?? 0)}
                  min={0}
                  precision={2}
                  prefix="¥"
                  style={{ width: 140 }}
                />
              </div>
            </div>

            {detail.stock_deducted && (
              <Tag color="green" style={{ marginTop: 12 }}>库存已扣除</Tag>
            )}
          </>
        )}
      </Spin>

      {printDetail && (
        <BillingPrint
          ref={printRef}
          detail={printDetail}
          patientName={patientName}
          patientAge={patientAge}
          doctorName={doctorName}
        />
      )}
    </Drawer>
  );
}
