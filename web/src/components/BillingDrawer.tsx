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
  Card,
} from 'antd';
import {
  PrinterOutlined,
  DollarOutlined,
  CheckCircleOutlined,
  MedicineBoxOutlined,
} from '@ant-design/icons';
import type { BillingDetail } from '../api/billing';
import {
  getPrescriptionBilling,
  createPrescriptionBilling,
  deductStockAndBill,
  getRecordBillingDetail,
  createRecordBilling,
} from '../api/billing';
import BillingPrint from './BillingPrint';
import type { BillingPrintHandle } from './BillingPrint';
import useIsMobile from '../hooks/useIsMobile';

interface BillingDrawerProps {
  open: boolean;
  /** prescriptionId > 0: prescription billing; 0 or undefined: record-level billing (consultation fee only) */
  prescriptionId?: number;
  recordId?: number;
  patientName?: string;
  patientAge?: number;
  doctorName?: string;
  onClose: () => void;
}

export default function BillingDrawer({
  open,
  prescriptionId,
  recordId,
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

  const isRecordLevel = !prescriptionId;

  const loadDetail = useCallback(async () => {
    if (isRecordLevel && !recordId) return;
    if (!isRecordLevel && !prescriptionId) return;
    setLoading(true);
    try {
      const res = isRecordLevel
        ? await getRecordBillingDetail(recordId!)
        : await getPrescriptionBilling(prescriptionId!);
      const body = res as unknown as { code: number; data: BillingDetail };
      const d = body.data;
      setDetail(d);
      setConsultationFee(d.consultation_fee);
      // 实收默认等于应收（未保存过时 actual_paid 为 0）
      const total = (d.drug_cost_total ?? 0) + d.consultation_fee;
      setActualPaid(d.actual_paid > 0 ? d.actual_paid : total);
    } catch {
      message.error('加载收费明细失败');
    } finally {
      setLoading(false);
    }
  }, [prescriptionId, recordId, isRecordLevel]);

  useEffect(() => {
    if (open) loadDetail();
  }, [open, loadDetail]);

  const drugCostTotal = detail?.drug_cost_total ?? 0;
  const totalAmount = drugCostTotal + consultationFee;

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isRecordLevel) {
        await createRecordBilling(recordId!, {
          consultation_fee: consultationFee,
          actual_paid: actualPaid,
        });
      } else {
        await createPrescriptionBilling(prescriptionId!, {
          consultation_fee: consultationFee,
          actual_paid: actualPaid,
        });
      }
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
      if (isRecordLevel) {
        await createRecordBilling(recordId!, {
          consultation_fee: consultationFee,
          actual_paid: actualPaid,
        });
      } else {
        await createPrescriptionBilling(prescriptionId!, {
          consultation_fee: consultationFee,
          actual_paid: actualPaid,
        });
      }
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
      await deductStockAndBill(prescriptionId!, {
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

  const herbs = (detail?.items || []).filter((i) => i.category === 'herb');
  const patents = (detail?.items || []).filter((i) => i.category === 'patent');

  // -- Mobile card renderer for drug items --
  const renderMobileHerbCard = (item: BillingDetail['items'][0]) => (
    <Card
      key={item.herb_name}
      size="small"
      style={{ marginBottom: 8, borderRadius: 8 }}
      bodyStyle={{ padding: '8px 12px' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 500 }}>
          {item.herb_name}
          {!item.in_stock && <Tag color="orange" style={{ marginLeft: 4, fontSize: 11 }}>无库存</Tag>}
        </div>
        <span style={{ fontSize: 16, fontWeight: 600, color: '#cf1322' }}>¥{item.item_cost.toFixed(2)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, color: '#666', fontSize: 12 }}>
        <span>{item.dosage} × {item.doses}付</span>
        <span>单价: {item.in_stock ? `¥${parseFloat(item.unit_price.toFixed(3))}/克` : '-'}</span>
      </div>
    </Card>
  );

  const renderMobilePatentCard = (item: BillingDetail['items'][0]) => (
    <Card
      key={item.herb_name}
      size="small"
      style={{ marginBottom: 8, borderRadius: 8 }}
      bodyStyle={{ padding: '8px 12px' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 500 }}>
          <Tag color="purple" style={{ fontSize: 11, marginRight: 4 }}>成药</Tag>
          {item.herb_name}
          {!item.in_stock && <Tag color="orange" style={{ marginLeft: 4, fontSize: 11 }}>无库存</Tag>}
        </div>
        <span style={{ fontSize: 16, fontWeight: 600, color: '#cf1322' }}>¥{item.item_cost.toFixed(2)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, color: '#666', fontSize: 12 }}>
        <span>{item.dosage}</span>
        <span>单价: {item.in_stock ? `¥${parseFloat(item.unit_price.toFixed(3))}/盒` : '-'}</span>
      </div>
    </Card>
  );

  // -- Desktop table columns --
  const herbColumns = [
    {
      title: '药名',
      dataIndex: 'herb_name',
      key: 'herb_name',
      render: (name: string, record: { in_stock: boolean }) => (
        <span>{name}{!record.in_stock && <Tag color="orange" style={{ marginLeft: 4, fontSize: 11 }}>无库存</Tag>}</span>
      ),
    },
    { title: '用量(克)', dataIndex: 'dosage_val', key: 'dosage_val', width: 90, align: 'center' as const },
    {
      title: '单价(元/克)',
      dataIndex: 'unit_price',
      key: 'unit_price',
      width: 110,
      align: 'right' as const,
      render: (v: number, record: { in_stock: boolean }) => record.in_stock ? `¥${parseFloat(v.toFixed(3))}` : '-',
    },
    {
      title: '小计(元)',
      dataIndex: 'item_cost',
      key: 'item_cost',
      width: 100,
      align: 'right' as const,
      render: (v: number) => <span style={{ fontWeight: 600, color: '#cf1322' }}>¥{v.toFixed(2)}</span>,
    },
  ];

  const patentColumns = [
    {
      title: '药名',
      dataIndex: 'herb_name',
      key: 'herb_name',
      render: (name: string, record: { in_stock: boolean }) => (
        <span>{name}{!record.in_stock && <Tag color="orange" style={{ marginLeft: 4, fontSize: 11 }}>无库存</Tag>}</span>
      ),
    },
    { title: '用量(盒)', dataIndex: 'dosage_val', key: 'dosage_val', width: 90, align: 'center' as const },
    {
      title: '单价(元/盒)',
      dataIndex: 'unit_price',
      key: 'unit_price',
      width: 110,
      align: 'right' as const,
      render: (v: number, record: { in_stock: boolean }) => record.in_stock ? `¥${parseFloat(v.toFixed(3))}` : '-',
    },
    {
      title: '小计(元)',
      dataIndex: 'item_cost',
      key: 'item_cost',
      width: 100,
      align: 'right' as const,
      render: (v: number) => <span style={{ fontWeight: 600, color: '#cf1322' }}>¥{v.toFixed(2)}</span>,
    },
  ];

  const hasItems = herbs.length > 0 || patents.length > 0;

  return (
    <Drawer
      title={
        <Space>
          <DollarOutlined style={{ color: '#faad14', fontSize: 18 }} />
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            收费明细{detail?.formula_name ? ` — ${detail.formula_name}` : ''}
          </span>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={isMobile ? '100%' : 640}
      footer={
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          flexWrap: 'wrap',
          padding: isMobile ? '4px 0' : 0,
        }}>
          <Button
            onClick={handleSave}
            loading={saving}
            size={isMobile ? 'middle' : 'middle'}
          >
            保存
          </Button>
          <Button
            icon={<PrinterOutlined />}
            onClick={handlePrintOnly}
            loading={saving}
            size={isMobile ? 'middle' : 'middle'}
          >
            仅打印
          </Button>
          {!isRecordLevel && (
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
                icon={detail?.stock_deducted ? <CheckCircleOutlined /> : <DollarOutlined />}
                loading={saving}
                disabled={detail?.stock_deducted}
                size={isMobile ? 'middle' : 'middle'}
                style={detail?.stock_deducted ? {} : {
                  background: 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)',
                  borderColor: '#389e0d',
                  fontWeight: 600,
                  boxShadow: '0 2px 6px rgba(82, 196, 26, 0.4)',
                }}
              >
                {detail?.stock_deducted ? '库存已扣除' : '扣除库存并打印'}
              </Button>
            </Popconfirm>
          )}
        </div>
      }
    >
      <Spin spinning={loading}>
        {detail && (
          <>
            {/* Info header */}
            {!isRecordLevel && (
              <Descriptions
                column={isMobile ? 1 : 2}
                size="small"
                style={{ marginBottom: 16 }}
              >
                <Descriptions.Item label="方剂">{detail.formula_name || '自定义处方'}</Descriptions.Item>
                <Descriptions.Item label="付数">{detail.total_doses} 付</Descriptions.Item>
              </Descriptions>
            )}

            {/* Herb items */}
            {herbs.length > 0 && (
              <>
                <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <MedicineBoxOutlined style={{ color: '#1677ff' }} />
                  中药明细
                  {!isRecordLevel && <Tag color="blue" style={{ marginLeft: 4 }}>{detail.total_doses}付</Tag>}
                </div>
                {isMobile ? (
                  <div style={{ marginBottom: 12 }}>
                    {herbs.map(renderMobileHerbCard)}
                  </div>
                ) : (
                  <Table
                    dataSource={herbs}
                    columns={herbColumns}
                    rowKey="herb_name"
                    pagination={false}
                    size="small"
                    bordered
                    style={{ marginBottom: 12 }}
                  />
                )}
              </>
            )}

            {/* Patent items */}
            {patents.length > 0 && (
              <>
                <div style={{ fontWeight: 600, marginTop: herbs.length > 0 ? 12 : 0, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <MedicineBoxOutlined style={{ color: '#722ed1' }} />
                  中成药明细
                </div>
                {isMobile ? (
                  <div style={{ marginBottom: 12 }}>
                    {patents.map(renderMobilePatentCard)}
                  </div>
                ) : (
                  <Table
                    dataSource={patents}
                    columns={patentColumns}
                    rowKey="herb_name"
                    pagination={false}
                    size="small"
                    bordered
                    style={{ marginBottom: 12 }}
                  />
                )}
              </>
            )}

            {/* No items hint for record-level billing */}
            {isRecordLevel && !hasItems && (
              <div style={{
                textAlign: 'center',
                padding: '24px 16px',
                color: '#999',
                border: '1px dashed #d9d9d9',
                borderRadius: 8,
                marginBottom: 16,
              }}>
                仅收取诊疗费（无药品）
              </div>
            )}

            {/* Summary section */}
            <div style={{
              marginTop: 16,
              padding: isMobile ? '12px 14px' : '16px 20px',
              background: 'linear-gradient(135deg, #fff7e6 0%, #fff1cc 100%)',
              borderRadius: 10,
              border: '1px solid #ffe58f',
            }}>
              {hasItems && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, fontSize: 14, color: '#666' }}>
                  <span>药费合计</span>
                  <span style={{ width: 120, textAlign: 'right', fontWeight: 600, color: '#333' }}>¥{drugCostTotal.toFixed(2)}</span>
                </div>
              )}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                marginBottom: 12, fontSize: 14, color: '#666',
              }}>
                <span>诊疗费</span>
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
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                paddingTop: 12, borderTop: '1px solid #d9d9d9',
                fontSize: 18, fontWeight: 700, color: '#cf1322',
              }}>
                <span>应收</span>
                <span style={{ width: 120, textAlign: 'right' }}>¥{totalAmount.toFixed(2)}</span>
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                marginTop: 10, fontSize: 18, fontWeight: 700, color: '#389e0d',
              }}>
                <span>实收</span>
                <InputNumber
                  value={actualPaid}
                  onChange={(v) => setActualPaid(v ?? 0)}
                  min={0}
                  precision={2}
                  prefix="¥"
                  size="small"
                  style={{ width: 120, fontWeight: 700 }}
                />
              </div>
            </div>

            {detail.stock_deducted && (
              <Tag
                color="green"
                icon={<CheckCircleOutlined />}
                style={{ marginTop: 12, fontSize: 13, padding: '4px 12px' }}
              >
                库存已扣除
              </Tag>
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
