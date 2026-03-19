import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Table, Button, Space, InputNumber, Tag, message } from 'antd';
import { ReloadOutlined, BellOutlined, ClearOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listInventoryDrugs } from '../../api/inventory';
import type { InventoryDrug } from '../../api/inventory';
import useIsMobile from '../../hooks/useIsMobile';

const CONFIG_KEY = 'inventory-alert-config';

interface AlertConfig {
  herbThreshold: number;
  patentThreshold: number;
  scanInterval: number;
}

interface AlertRow extends InventoryDrug {
  effectiveThreshold: number;
  gap: number;
}

function loadConfig(): AlertConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        herbThreshold: parsed.herbThreshold ?? 500,
        patentThreshold: parsed.patentThreshold ?? 10,
        scanInterval: parsed.scanInterval ?? 30,
      };
    }
  } catch {
    // ignore
  }
  return { herbThreshold: 500, patentThreshold: 10, scanInterval: 30 };
}

export default function InventoryAlert() {
  const isMobile = useIsMobile();
  const [config, setConfig] = useState<AlertConfig>(loadConfig);
  const [editConfig, setEditConfig] = useState<AlertConfig>(loadConfig);
  const [alertRows, setAlertRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const lastScanRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runScan = useCallback(async (): Promise<number> => {
    setLoading(true);
    try {
      const res = await listInventoryDrugs({ size: 9999 });
      const body = res as any;
      const drugs: InventoryDrug[] = body.data?.list || [];

      const currentConfig = loadConfig();
      const rawMuted = JSON.parse(localStorage.getItem('inventory-alert-muted') || '[]');
      const muted: number[] = Array.isArray(rawMuted) ? rawMuted : [];
      if (!Array.isArray(rawMuted)) localStorage.removeItem('inventory-alert-muted');

      const rows: AlertRow[] = [];
      for (const drug of drugs) {
        const threshold =
          drug.alert_threshold != null
            ? drug.alert_threshold
            : drug.category === 'herb'
            ? currentConfig.herbThreshold
            : currentConfig.patentThreshold;

        if (drug.stock > threshold) continue;
        if (muted.includes(drug.id)) continue;

        rows.push({
          ...drug,
          effectiveThreshold: threshold,
          gap: threshold - drug.stock,
        });
      }
      setAlertRows(rows);
      setLastScanTime(new Date());
      lastScanRef.current = Date.now();
      return rows.length;
    } catch {
      return -1;
    } finally {
      setLoading(false);
    }
  }, []);

  // Run scan on mount and on config changes — clear muted so all alerts re-evaluate
  useEffect(() => {
    let cancelled = false;
    localStorage.removeItem('inventory-alert-muted');
    runScan().then((count) => {
      if (!cancelled && count >= 0) window.dispatchEvent(new CustomEvent('inventory-alert-changed', { detail: { count } }));
    });
    return () => { cancelled = true; };
  }, [runScan, config]);

  // Clear muted list and re-scan when inventory data changes
  useEffect(() => {
    const onDataChanged = () => {
      localStorage.removeItem('inventory-alert-muted');
      runScan().then((count) => {
        if (count >= 0) window.dispatchEvent(new CustomEvent('inventory-alert-changed', { detail: { count } }));
      });
    };
    window.addEventListener('inventory-data-changed', onDataChanged);
    return () => window.removeEventListener('inventory-data-changed', onDataChanged);
  }, [runScan]);

  // Robust periodic scan: setTimeout chain + visibilitychange fallback
  useEffect(() => {
    const intervalMs = config.scanInterval * 60 * 1000;

    const scheduleNext = () => {
      timerRef.current = setTimeout(async () => {
        localStorage.removeItem('inventory-alert-muted');
        const count = await runScan();
        if (count >= 0) window.dispatchEvent(new CustomEvent('inventory-alert-changed', { detail: { count } }));
        scheduleNext();
      }, intervalMs);
    };
    scheduleNext();

    // When page becomes visible, check if we missed a scan cycle
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastScanRef.current;
        if (elapsed >= intervalMs) {
          if (timerRef.current) clearTimeout(timerRef.current);
          localStorage.removeItem('inventory-alert-muted');
          runScan().then((count) => {
            if (count >= 0) window.dispatchEvent(new CustomEvent('inventory-alert-changed', { detail: { count } }));
            scheduleNext();
          });
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [config.scanInterval, runScan]);

  const handleSaveConfig = () => {
    const newConfig: AlertConfig = {
      herbThreshold: editConfig.herbThreshold ?? 500,
      patentThreshold: editConfig.patentThreshold ?? 10,
      scanInterval: editConfig.scanInterval ?? 30,
    };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(newConfig));
    setConfig(newConfig);
    message.success('配置已保存');
  };

  const handleDismiss = (drugId: number) => {
    const rawMuted = JSON.parse(localStorage.getItem('inventory-alert-muted') || '[]');
    const muted: number[] = Array.isArray(rawMuted) ? rawMuted : [];
    muted.push(drugId);
    localStorage.setItem('inventory-alert-muted', JSON.stringify(muted));
    const next = alertRows.filter((r) => r.id !== drugId);
    setAlertRows(next);
    window.dispatchEvent(new CustomEvent('inventory-alert-changed', { detail: { count: next.length } }));
    message.success('已忽略该告警');
  };

  const handleDismissAll = () => {
    if (alertRows.length === 0) return;
    const rawMuted = JSON.parse(localStorage.getItem('inventory-alert-muted') || '[]');
    const existing: number[] = Array.isArray(rawMuted) ? rawMuted : [];
    const muted = [...new Set([...existing, ...alertRows.map((r) => r.id)])];
    localStorage.setItem('inventory-alert-muted', JSON.stringify(muted));
    setAlertRows([]);
    window.dispatchEvent(new CustomEvent('inventory-alert-changed', { detail: { count: 0 } }));
    message.success(`已忽略全部 ${muted.length} 条告警`);
  };

  const handleManualScan = async () => {
    localStorage.removeItem('inventory-alert-muted');
    const count = await runScan();
    if (count >= 0) window.dispatchEvent(new CustomEvent('inventory-alert-changed', { detail: { count } }));
  };

  const columns: ColumnsType<AlertRow> = [
    {
      title: '药物名',
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: '货架号',
      dataIndex: 'shelf_no',
      key: 'shelf_no',
      width: 80,
      render: (val: string) => val || 'H1',
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 80,
      responsive: ['md'] as any,
      render: (val: string) =>
        val === 'herb' ? (
          <Tag color="green">本草</Tag>
        ) : (
          <Tag color="blue">成药</Tag>
        ),
    },
    {
      title: '当前库存',
      key: 'stock',
      width: 110,
      render: (_, record) =>
        `${record.stock} ${record.category === 'herb' ? '克' : '盒'}`,
    },
    {
      title: '阈值',
      key: 'effectiveThreshold',
      width: 100,
      responsive: ['md'] as any,
      render: (_, record) =>
        `${record.effectiveThreshold} ${record.category === 'herb' ? '克' : '盒'}`,
    },
    {
      title: '缺口量',
      key: 'gap',
      width: 100,
      responsive: ['md'] as any,
      render: (_, record) =>
        `${record.gap.toFixed(2)} ${record.category === 'herb' ? '克' : '盒'}`,
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_, record) => (
        <Button
          size="small"
          type="default"
          onClick={() => handleDismiss(record.id)}
        >
          忽略
        </Button>
      ),
    },
  ];

  // --- Mobile card view for alerts ---
  const renderMobileAlertCard = (row: AlertRow) => {
    const unit = row.category === 'herb' ? '克' : '盒';
    return (
      <Card
        key={row.id}
        size="small"
        style={{ marginBottom: 8, background: '#fff1f0', borderColor: '#ffccc7' }}
        styles={{ body: { padding: '10px 12px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{row.name}</span>
            <Tag color={row.category === 'herb' ? 'green' : 'blue'} style={{ margin: 0 }}>
              {row.category === 'herb' ? '草' : '成'}
            </Tag>
            <Tag style={{ margin: 0 }}>{row.shelf_no || 'H1'}</Tag>
          </div>
          <Button size="small" onClick={() => handleDismiss(row.id)}>忽略</Button>
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 13, color: '#666' }}>
          <span>库存 <span style={{ color: '#ff4d4f', fontWeight: 500 }}>{row.stock}{unit}</span></span>
          <span>阈值 {row.effectiveThreshold}{unit}</span>
          <span>缺 <span style={{ color: '#ff4d4f', fontWeight: 500 }}>{row.gap.toFixed(0)}{unit}</span></span>
        </div>
      </Card>
    );
  };

  // --- Mobile config ---
  const renderMobileConfig = () => (
    <Card
      title={
        <Space>
          <BellOutlined style={{ color: '#ff4d4f' }} />
          <span>预警配置</span>
        </Space>
      }
      style={{ marginBottom: 12 }}
      size="small"
      styles={{ body: { padding: 12 } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, flexShrink: 0, width: 80 }}>本草阈值</span>
          <InputNumber
            min={0}
            value={editConfig.herbThreshold}
            onChange={(val) => setEditConfig((prev) => ({ ...prev, herbThreshold: val ?? 500 }))}
            addonAfter="克"
            style={{ flex: 1 }}
            size="small"
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, flexShrink: 0, width: 80 }}>成药阈值</span>
          <InputNumber
            min={0}
            value={editConfig.patentThreshold}
            onChange={(val) => setEditConfig((prev) => ({ ...prev, patentThreshold: val ?? 10 }))}
            addonAfter="盒"
            style={{ flex: 1 }}
            size="small"
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, flexShrink: 0, width: 80 }}>扫描频率</span>
          <InputNumber
            min={1}
            value={editConfig.scanInterval}
            onChange={(val) => setEditConfig((prev) => ({ ...prev, scanInterval: val ?? 30 }))}
            addonAfter="分钟"
            style={{ flex: 1 }}
            size="small"
          />
        </div>
        <Button type="primary" onClick={handleSaveConfig} block size="small">
          保存配置
        </Button>
      </div>
    </Card>
  );

  // --- Desktop config ---
  const renderDesktopConfig = () => (
    <Card
      title={
        <Space>
          <BellOutlined style={{ color: '#ff4d4f' }} />
          <span>预警配置</span>
        </Space>
      }
      style={{ marginBottom: 16 }}
      size="small"
    >
      <Space wrap align="center">
        <span>本草默认阈值：</span>
        <InputNumber
          min={0}
          value={editConfig.herbThreshold}
          onChange={(val) => setEditConfig((prev) => ({ ...prev, herbThreshold: val ?? 500 }))}
          addonAfter="克"
          style={{ width: 140 }}
        />
        <span>成药默认阈值：</span>
        <InputNumber
          min={0}
          value={editConfig.patentThreshold}
          onChange={(val) => setEditConfig((prev) => ({ ...prev, patentThreshold: val ?? 10 }))}
          addonAfter="盒"
          style={{ width: 140 }}
        />
        <span>扫描频率：</span>
        <InputNumber
          min={1}
          value={editConfig.scanInterval}
          onChange={(val) => setEditConfig((prev) => ({ ...prev, scanInterval: val ?? 30 }))}
          addonAfter="分钟"
          style={{ width: 140 }}
        />
        <Button type="primary" onClick={handleSaveConfig}>
          保存配置
        </Button>
      </Space>
    </Card>
  );

  return (
    <>
      <style>{`
        .alert-row { background-color: #fff1f0 !important; }
        .alert-row:hover > td { background-color: #ffccc7 !important; }
      `}</style>

      {/* Config */}
      {isMobile ? renderMobileConfig() : renderDesktopConfig()}

      {/* Alert list */}
      <Card
        title={
          <Space size={isMobile ? 4 : 8}>
            <BellOutlined style={{ color: '#ff4d4f' }} />
            <span style={isMobile ? { fontSize: 14 } : undefined}>预警列表</span>
            {alertRows.length > 0 && (
              <Tag color="red">{alertRows.length} 项</Tag>
            )}
          </Space>
        }
        extra={
          <Space size={isMobile ? 4 : 8}>
            {lastScanTime && (
              <span style={{ fontSize: 12, color: '#999' }}>
                {lastScanTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            {alertRows.length > 0 && (
              <Button
                icon={<ClearOutlined />}
                onClick={handleDismissAll}
                type="default"
                size={isMobile ? 'small' : 'middle'}
                danger
              >
                {isMobile ? '忽略全部' : '忽略全部告警'}
              </Button>
            )}
            <Button
              icon={<ReloadOutlined />}
              onClick={handleManualScan}
              loading={loading}
              type="default"
              size={isMobile ? 'small' : 'middle'}
            >
              {!isMobile && '立即扫描'}
            </Button>
          </Space>
        }
        size={isMobile ? 'small' : 'default'}
        styles={isMobile ? { body: { padding: 8 } } : undefined}
      >
        {isMobile ? (
          loading ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>扫描中...</div>
          ) : alertRows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#52c41a' }}>暂无库存预警，库存充足</div>
          ) : (
            alertRows.map(renderMobileAlertCard)
          )
        ) : (
          <Table<AlertRow>
            rowKey="id"
            columns={columns}
            dataSource={alertRows}
            loading={loading}
            rowClassName={() => 'alert-row'}
            pagination={false}
            locale={{ emptyText: '暂无库存预警，库存充足' }}
          />
        )}
      </Card>
    </>
  );
}
