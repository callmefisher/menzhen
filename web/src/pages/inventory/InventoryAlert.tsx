import { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Space, InputNumber, Tag, message, Dropdown } from 'antd';
import { ReloadOutlined, BellOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listInventoryDrugs } from '../../api/inventory';
import type { InventoryDrug } from '../../api/inventory';
import useIsMobile from '../../hooks/useIsMobile';

const CONFIG_KEY = 'inventory-alert-config';
const MUTED_KEY = 'inventory-alert-muted';

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

function loadMuted(): Record<number, number> {
  try {
    const raw = localStorage.getItem(MUTED_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function saveMuted(muted: Record<number, number>) {
  localStorage.setItem(MUTED_KEY, JSON.stringify(muted));
}

export default function InventoryAlert() {
  const isMobile = useIsMobile();
  const [config, setConfig] = useState<AlertConfig>(loadConfig);
  const [editConfig, setEditConfig] = useState<AlertConfig>(loadConfig);
  const [alertRows, setAlertRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(false);

  const runScan = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listInventoryDrugs({ size: 9999 });
      const body = res as any;
      const drugs: InventoryDrug[] = body.data?.list || [];

      const muted = loadMuted();
      const now = Date.now();

      // Clean up expired mutes
      let mutedChanged = false;
      for (const key of Object.keys(muted)) {
        const id = Number(key);
        if (now > muted[id]) {
          delete muted[id];
          mutedChanged = true;
        }
      }
      if (mutedChanged) saveMuted(muted);

      const currentConfig = loadConfig();
      const rows: AlertRow[] = [];
      for (const drug of drugs) {
        const threshold =
          drug.alert_threshold != null
            ? drug.alert_threshold
            : drug.category === 'herb'
            ? currentConfig.herbThreshold
            : currentConfig.patentThreshold;

        if (drug.stock >= threshold) continue;

        const muteUntil = muted[drug.id];
        if (muteUntil && now < muteUntil) continue;

        rows.push({
          ...drug,
          effectiveThreshold: threshold,
          gap: threshold - drug.stock,
        });
      }
      setAlertRows(rows);
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  // Run scan on mount and on config changes
  useEffect(() => {
    runScan();
  }, [runScan, config]);

  // Set up periodic scan timer
  useEffect(() => {
    const intervalMs = config.scanInterval * 60 * 1000;
    const timer = setInterval(() => {
      runScan();
    }, intervalMs);
    return () => clearInterval(timer);
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

  const handleMute = (drugId: number, hours: number) => {
    const muted = loadMuted();
    muted[drugId] = Date.now() + hours * 3600 * 1000;
    saveMuted(muted);
    setAlertRows((prev) => prev.filter((r) => r.id !== drugId));
    message.success(`已屏蔽 ${hours} 小时`);
  };

  const getMuteMenuItems = (drugId: number) => [
    { key: '1', label: '1小时', onClick: () => handleMute(drugId, 1) },
    { key: '6', label: '6小时', onClick: () => handleMute(drugId, 6) },
    { key: '12', label: '12小时', onClick: () => handleMute(drugId, 12) },
    { key: '24', label: '24小时', onClick: () => handleMute(drugId, 24) },
  ];

  const columns: ColumnsType<AlertRow> = [
    {
      title: '药物名',
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 80,
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
      render: (_, record) =>
        `${record.effectiveThreshold} ${record.category === 'herb' ? '克' : '盒'}`,
    },
    {
      title: '缺口量',
      key: 'gap',
      width: 100,
      render: (_, record) =>
        `${record.gap.toFixed(2)} ${record.category === 'herb' ? '克' : '盒'}`,
    },
    {
      title: '操作',
      key: 'action',
      width: isMobile ? 80 : 120,
      render: (_, record) => (
        <Dropdown menu={{ items: getMuteMenuItems(record.id) }} trigger={['click']}>
          <Button size="small" type="default">
            屏蔽
          </Button>
        </Dropdown>
      ),
    },
  ];

  return (
    <>
      <style>{`
        .alert-row { background-color: #fff1f0 !important; }
        .alert-row:hover > td { background-color: #ffccc7 !important; }
      `}</style>

      {/* Global threshold config */}
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
            onChange={(val) =>
              setEditConfig((prev) => ({ ...prev, herbThreshold: val ?? 500 }))
            }
            addonAfter="克"
            style={{ width: 140 }}
          />
          <span>成药默认阈值：</span>
          <InputNumber
            min={0}
            value={editConfig.patentThreshold}
            onChange={(val) =>
              setEditConfig((prev) => ({ ...prev, patentThreshold: val ?? 10 }))
            }
            addonAfter="盒"
            style={{ width: 140 }}
          />
          <span>扫描频率：</span>
          <InputNumber
            min={1}
            value={editConfig.scanInterval}
            onChange={(val) =>
              setEditConfig((prev) => ({ ...prev, scanInterval: val ?? 30 }))
            }
            addonAfter="分钟"
            style={{ width: 140 }}
          />
          <Button type="primary" onClick={handleSaveConfig}>
            保存配置
          </Button>
        </Space>
      </Card>

      {/* Alert list */}
      <Card
        title={
          <Space>
            <BellOutlined style={{ color: '#ff4d4f' }} />
            <span>库存预警列表</span>
            {alertRows.length > 0 && (
              <Tag color="red">{alertRows.length} 项需补货</Tag>
            )}
          </Space>
        }
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={runScan}
            loading={loading}
            type="default"
          >
            {!isMobile && '立即扫描'}
          </Button>
        }
      >
        <Table<AlertRow>
          rowKey="id"
          columns={columns}
          dataSource={alertRows}
          loading={loading}
          rowClassName={() => 'alert-row'}
          pagination={false}
          locale={{ emptyText: '暂无库存预警，库存充足' }}
        />
      </Card>
    </>
  );
}
