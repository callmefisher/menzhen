import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import DiskMonitor from '../index'
import * as diskApi from '../../../api/disk'

vi.mock('../../../api/disk')
vi.mock('../MigrateWizard', () => ({ default: () => null }))
vi.mock('../BackupDirChange', () => ({ default: () => null }))

describe('DiskMonitor', () => {
  const mockGetStatus = vi.mocked(diskApi.getDiskStatus)
  const mockSetInterval = vi.mocked(diskApi.setDiskInterval)

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStatus.mockResolvedValue({
      data: {
        total: 500 * 1024 ** 3,
        used: 200 * 1024 ** 3,
        free: 300 * 1024 ** 3,
        used_pct: 40,
        mysql_used: 20 * 1024 ** 3,
        minio_used: 100 * 1024 ** 3,
        backup_used: 30 * 1024 ** 3,
        collected_at: '2026-04-06T10:00:00Z',
        interval: 3600,
      }
    } as any)
    mockSetInterval.mockResolvedValue({ data: {} } as any)
  })

  it('renders disk usage stats', async () => {
    render(<DiskMonitor />)
    await waitFor(() => expect(screen.getByText(/40%/)).toBeInTheDocument())
    expect(screen.getByText(/MySQL/)).toBeInTheDocument()
    expect(screen.getByText(/MinIO/)).toBeInTheDocument()
  })

  it('shows red border and warning banner when usage >= 90%', async () => {
    mockGetStatus.mockResolvedValueOnce({
      data: {
        total: 100 * 1024 ** 3,
        used: 92 * 1024 ** 3,
        free: 8 * 1024 ** 3,
        used_pct: 92,
        mysql_used: 0,
        minio_used: 0,
        backup_used: 0,
        collected_at: '2026-04-06T10:00:00Z',
        interval: 60,
      }
    } as any)
    render(<DiskMonitor />)
    await waitFor(() => expect(screen.getByText(/磁盘告急/)).toBeInTheDocument())
  })

  it('calls setInterval when interval button clicked', async () => {
    render(<DiskMonitor />)
    await waitFor(() => screen.getByText('1m'))
    fireEvent.click(screen.getByText('1m'))
    await waitFor(() => expect(mockSetInterval).toHaveBeenCalledWith(60))
  })
})
