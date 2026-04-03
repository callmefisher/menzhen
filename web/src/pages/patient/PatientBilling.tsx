import { useEffect, useState } from 'react';
import { List, Card, Empty, Spin, Statistic } from 'antd';
import { listBillings } from '../../api/patientPortal';
import type { Billing } from '../../api/patientPortal';

export default function PatientBilling() {
  const [billings, setBillings] = useState<Billing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listBillings().then((res) => setBillings(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  return (
    <div style={{ padding: '16px 12px' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>收费明细</div>
      {billings.length === 0 ? <Empty description="暂无收费记录" /> : (
        <List dataSource={billings} renderItem={(b) => (
          <Card key={b.id} size="small" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, color: '#aaa' }}>{b.created_at?.slice(0, 10)}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>诊费 ¥{b.consultation_fee?.toFixed(2)} + 药费 ¥{b.drug_cost_total?.toFixed(2)}</div>
              </div>
              <Statistic value={b.actual_paid} precision={2} prefix="¥" valueStyle={{ fontSize: 18, color: '#52C41A', fontWeight: 700 }} />
            </div>
          </Card>
        )} />
      )}
    </div>
  );
}
