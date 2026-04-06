import React, { useEffect, useState } from 'react'
import { Modal, Select, Input, Space, Alert, Typography, Spin } from 'antd'
import { listVolumes } from '../../api/disk'
import type { DockerVolume } from '../../api/disk'

interface Props {
  open: boolean
  title?: string
  value: string
  onChange: (v: string) => void
  onClose: () => void
}

const VolumePicker: React.FC<Props> = ({ open, title = '选择目标', value, onChange, onClose }) => {
  const [volumes, setVolumes] = useState<DockerVolume[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // local draft — only committed to parent on OK, never on every keystroke
  const [selected, setSelected] = useState('')
  const [custom, setCustom] = useState('')

  useEffect(() => {
    if (!open) return
    // Reset draft to current parent value when opening
    setSelected(value)
    setCustom('')
    setLoading(true)
    setError(null)
    listVolumes()
      .then(res => setVolumes(res.data ?? []))
      .catch(() => setError('加载 Docker volumes 失败'))
      .finally(() => setLoading(false))
  }, [open, value])

  const handleOk = () => {
    const chosen = custom.trim() || selected
    if (chosen) onChange(chosen)
    onClose()
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText="确认"
      cancelText="取消"
      width={480}
      destroyOnHidden
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {loading ? (
          <Spin />
        ) : error ? (
          <Alert type="error" message={error} />
        ) : (
          <>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                从现有 Docker volumes 选择（推荐）
              </Typography.Text>
              <Select
                style={{ width: '100%', marginTop: 4 }}
                placeholder="选择已有 volume"
                allowClear
                value={selected || undefined}
                onChange={v => { setSelected(v ?? ''); setCustom('') }}
                options={volumes.map(v => ({
                  value: v.name,
                  label: (
                    <Space>
                      <span>{v.name}</span>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        ({v.driver})
                      </Typography.Text>
                    </Space>
                  ),
                }))}
              />
            </div>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                或输入新 volume 名 / 宿主机绝对路径
              </Typography.Text>
              <Input
                style={{ marginTop: 4 }}
                placeholder="mysql-data-ssd  或  /mnt/ssd/mysql"
                value={custom}
                onChange={e => { setCustom(e.target.value); setSelected('') }}
              />
            </div>
            <Alert
              type="info"
              showIcon
              message="输入新 volume 名时 Docker 会自动创建；使用路径时请确保磁盘已挂载。"
            />
          </>
        )}
      </Space>
    </Modal>
  )
}

export default VolumePicker
