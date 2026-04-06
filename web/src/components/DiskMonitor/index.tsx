import React, { useEffect, useState, useRef, useCallback } from 'react'
import {
  Card, Row, Col, Progress, Typography, Space, Tag, Alert, Button, Segmented, InputNumber, message
} from 'antd'
import { ReloadOutlined, HddOutlined } from '@ant-design/icons'
import { getDiskStatus, setDiskInterval, DiskStatus } from '../../api/disk'
import MigrateWizard from './MigrateWizard'
import BackupDirChange from './BackupDirChange'
import useIsMobile from '../../hooks/useIsMobile'

const { Text } = Typography

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return (bytes / 1024 ** 4).toFixed(1) + ' TB'
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + ' GB'
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB'
  return (bytes / 1024).toFixed(0) + ' KB'
}

function statusColor(pct: number): string {
  if (pct >= 90) return '#ff4d4f'
  if (pct >= 70) return '#faad14'
  return '#52c41a'
}

const PRESET_INTERVALS = [
  { label: '1m', value: 60 },
  { label: '10m', value: 600 },
  { label: '1h', value: 3600 },
]

const DiskMonitor: React.FC = () => {
  const isMobile = useIsMobile()
  const [status, setStatus] = useState<DiskStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [customInterval, setCustomInterval] = useState<number | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [migrateOpen, setMigrateOpen] = useState(false)
  const [backupDirOpen, setBackupDirOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    getDiskStatus()
      .then(res => { setStatus(res.data.data) })
      .catch(() => {
        if (!controller.signal.aborted) setError('磁盘状态获取失败')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return controller
  }, [])

  useEffect(() => {
    const controller = fetchStatus()
    return () => controller.abort()
  }, [fetchStatus])

  // Auto-refresh at configured interval
  useEffect(() => {
    if (!status) return
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(fetchStatus, status.interval * 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [status?.interval, fetchStatus])

  const handleIntervalChange = async (seconds: number) => {
    try {
      await setDiskInterval(seconds)
      setStatus(prev => prev ? { ...prev, interval: seconds } : prev)
      message.success('采集间隔已更新')
    } catch {
      message.error('更新失败')
    }
  }

  const isCritical = (status?.used_pct ?? 0) >= 90
  const isWarning = !isCritical && (status?.used_pct ?? 0) >= 70

  const currentIntervalLabel =
    PRESET_INTERVALS.find(p => p.value === status?.interval)?.label ?? '自定义'

  return (
    <Card
      style={{ marginTop: 24, borderColor: isCritical ? '#ff4d4f' : undefined }}
      title={
        <Space>
          <HddOutlined />
          磁盘监控和迁移
          <Tag color={isCritical ? 'red' : isWarning ? 'orange' : 'green'}>
            {isCritical ? '告急' : isWarning ? '不足' : '充足'}
          </Tag>
        </Space>
      }
      extra={
        <Button icon={<ReloadOutlined spin={loading} />} size="small" onClick={fetchStatus}>
          刷新
        </Button>
      }
    >
      {isCritical && (
        <Alert type="error" message="磁盘告急：可用空间不足 10%，请立即处理！" style={{ marginBottom: 16 }} />
      )}
      {error && !isCritical && (
        <Alert type="warning" message={error} style={{ marginBottom: 16 }} />
      )}

      {/* Stats row */}
      {status && (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            {[
              { label: '总量', value: formatBytes(status.total), color: '#aaa' },
              { label: '剩余', value: formatBytes(status.free), color: statusColor(status.used_pct) },
              { label: '已用', value: `${Math.round(status.used_pct)}%`, color: statusColor(status.used_pct) },
              { label: '备份', value: formatBytes(status.backup_used), color: '#aaa' },
            ].map(item => (
              <Col key={item.label} xs={12} sm={6}>
                <Card size="small" style={{ textAlign: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{item.label}</Text>
                  <div style={{ fontSize: 18, fontWeight: 700, color: item.color }}>{item.value}</div>
                </Card>
              </Col>
            ))}
          </Row>

          {/* Bar chart */}
          {[
            { label: 'MySQL', used: status.mysql_used, total: status.total },
            { label: 'MinIO', used: status.minio_used, total: status.total },
            { label: '备份文件', used: status.backup_used, total: status.total },
            { label: '系统/其他', used: Math.max(0, status.used - status.mysql_used - status.minio_used - status.backup_used), total: status.total },
          ].map(item => {
            const pct = item.total > 0 ? (item.used / item.total) * 100 : 0
            return (
              <Row key={item.label} gutter={8} align="middle" style={{ marginBottom: 8 }}>
                <Col xs={6} sm={4}><Text style={{ fontSize: 13 }}>{item.label}</Text></Col>
                <Col xs={12} sm={16}>
                  <div className={pct >= 90 ? 'disk-bar-critical' : undefined}>
                    <Progress
                      percent={Math.round(pct)}
                      strokeColor={statusColor(pct)}
                      showInfo={false}
                      size={isMobile ? 'small' : 'default'}
                    />
                  </div>
                </Col>
                <Col xs={6} sm={4} style={{ textAlign: 'right' }}>
                  <Text style={{ fontSize: 12, color: statusColor(pct) }}>
                    {pct.toFixed(1)}% · {formatBytes(item.used)}
                  </Text>
                </Col>
              </Row>
            )
          })}

          {/* Interval control */}
          <Row align="middle" gutter={8} style={{ marginTop: 16 }}>
            <Col><Text type="secondary" style={{ fontSize: 13 }}>刷新间隔</Text></Col>
            <Col>
              <Segmented
                size="small"
                options={[...PRESET_INTERVALS.map(p => p.label), '自定义']}
                value={currentIntervalLabel}
                onChange={val => {
                  if (val === '自定义') {
                    setShowCustom(true)
                  } else {
                    setShowCustom(false)
                    const preset = PRESET_INTERVALS.find(p => p.label === val)
                    if (preset) handleIntervalChange(preset.value)
                  }
                }}
              />
            </Col>
            <Col>
              <Text type="secondary" style={{ fontSize: 12 }}>
                更新: {new Date(status.collected_at).toLocaleTimeString()}
              </Text>
            </Col>
          </Row>
          {showCustom && (
            <Row align="middle" gutter={8} style={{ marginTop: 8 }}>
              <Col>
                <InputNumber
                  min={1} max={60} placeholder="分钟" size="small"
                  value={customInterval ?? undefined}
                  onChange={v => setCustomInterval(v)}
                />
              </Col>
              <Col>
                <Button
                  size="small" type="primary"
                  onClick={() => {
                    if (customInterval !== null && customInterval >= 1 && customInterval <= 60) {
                      handleIntervalChange(customInterval * 60)
                      setShowCustom(false)
                    }
                  }}
                >保存</Button>
              </Col>
            </Row>
          )}

          {/* Action buttons */}
          <Row gutter={8} style={{ marginTop: 16 }} wrap>
            <Col>
              <Button type="primary" onClick={() => setMigrateOpen(true)}>
                数据迁移向导 →
              </Button>
            </Col>
            <Col>
              <Button onClick={() => setBackupDirOpen(true)}>
                更换备份目录 →
              </Button>
            </Col>
          </Row>
        </>
      )}

      <MigrateWizard open={migrateOpen} onClose={() => setMigrateOpen(false)} />
      <BackupDirChange open={backupDirOpen} onClose={() => setBackupDirOpen(false)} />
    </Card>
  )
}

export default DiskMonitor
