import React, { useState, useRef, useEffect } from 'react'
import {
  Modal, Steps, Form, Input, Button, Space, Select, Alert,
  Typography, Progress, message
} from 'antd'
import { startMigrate, getMigrateStatus } from '../../api/disk'
import type { DiskTask } from '../../api/disk'
import VolumePicker from './VolumePicker'

interface Props {
  open: boolean
  onClose: () => void
}

const STEP_LABELS = [
  '触发完整备份',
  '停止数据库容器',
  '复制数据',
  '更新配置文件',
  '重启容器',
  '验证连通性',
]

const MigrateWizard: React.FC<Props> = ({ open, onClose }) => {
  const [target, setTarget] = useState<'mysql' | 'minio'>('mysql')
  const [newPath, setNewPath] = useState('')
  const [task, setTask] = useState<DiskTask | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => () => stopPoll(), [])

  // Stop polling when modal is hidden (not unmounted — AntD keeps Modal in DOM by default)
  useEffect(() => {
    if (!open) stopPoll()
  }, [open])

  const handleStart = async () => {
    if (!newPath.trim()) {
      message.warning('请填写目标路径')
      return
    }
    try {
      const res = await startMigrate(target, newPath.trim())
      const t = res.data
      setTask(t)
      pollRef.current = setInterval(async () => {
        try {
          const r = await getMigrateStatus(t.task_id)
          const updated = r.data
          setTask(updated)
          if (updated.status !== 'running') stopPoll()
        } catch {
          stopPoll()
        }
      }, 2000)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } }
      message.error(axiosErr.response?.data?.error ?? '启动失败')
    }
  }

  const handleClose = () => {
    stopPoll()
    setTask(null)
    setNewPath('')
    onClose()
  }

  const isRunning = task?.status === 'running'

  return (
    <>
      <Modal
        title={`${target === 'mysql' ? 'MySQL' : 'MinIO'} 数据迁移向导`}
        open={open}
        onCancel={handleClose}
        footer={null}
        width={560}
      >
        {!task ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Alert
              type="warning"
              message="注意：迁移过程中数据库服务将停止（约数分钟至数十分钟），建议在业务低峰期执行。"
            />
            <Form layout="vertical">
              <Form.Item label="迁移目标">
                <Select
                  value={target}
                  onChange={v => setTarget(v)}
                  options={[
                    { value: 'mysql', label: 'MySQL 数据目录' },
                    { value: 'minio', label: 'MinIO 数据目录' },
                  ]}
                />
              </Form.Item>
              <Form.Item label="新目标路径（volume 名或宿主机绝对路径）">
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    value={newPath}
                    onChange={e => setNewPath(e.target.value)}
                    placeholder="mysql-data-ssd 或 /mnt/ssd/mysql"
                  />
                  <Button onClick={() => setBrowsing(true)}>📦 选择</Button>
                </Space.Compact>
              </Form.Item>
            </Form>
            <Button type="primary" danger onClick={handleStart}>
              开始迁移
            </Button>
          </Space>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Steps
              current={task.step - 1}
              status={task.status === 'failed' ? 'error' : task.status === 'success' ? 'finish' : 'process'}
              items={STEP_LABELS.map(label => ({ title: label }))}
              direction="vertical"
              size="small"
            />
            {isRunning && (
              <Progress percent={Math.round((task.step / task.total) * 100)} status="active" />
            )}
            {task.status === 'success' && (
              <Alert type="success" message={`迁移成功：${task.output.split('\n').pop()}`} />
            )}
            {task.status === 'failed' && (
              <Alert type="error" message={`迁移失败：${task.output.split('\n').pop()}`} />
            )}
            <Typography.Text style={{ fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              {task.output}
            </Typography.Text>
            {!isRunning && (
              <Button onClick={handleClose}>关闭</Button>
            )}
          </Space>
        )}
      </Modal>

      <VolumePicker
        open={browsing}
        title="选择迁移目标 volume"
        value={newPath}
        onChange={path => setNewPath(path)}
        onClose={() => setBrowsing(false)}
      />
    </>
  )
}

export default MigrateWizard
