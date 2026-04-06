import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import VolumePicker from '../VolumePicker'
import * as diskApi from '../../../api/disk'

vi.mock('../../../api/disk', () => ({
  listVolumes: vi.fn(),
}))

const mockListVolumes = vi.mocked(diskApi.listVolumes)

const volumes = [
  { name: 'mysql-data', driver: 'local', mountpoint: '/var/lib/docker/volumes/mysql-data/_data', created_at: '' },
  { name: 'minio-data', driver: 'local', mountpoint: '/var/lib/docker/volumes/minio-data/_data', created_at: '' },
]

beforeEach(() => vi.clearAllMocks())

describe('VolumePicker', () => {
  it('shows loading spinner while fetching', () => {
    mockListVolumes.mockReturnValue(new Promise(() => {})) // never resolves
    render(
      <VolumePicker open value="" onChange={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByRole('img', { hidden: true })).toBeDefined() // antd Spin
  })

  it('renders volume list from API', async () => {
    mockListVolumes.mockResolvedValue({ data: volumes } as any)
    render(
      <VolumePicker open value="" onChange={vi.fn()} onClose={vi.fn()} />
    )
    // After API resolves, the Select placeholder and info Alert should appear
    await waitFor(() => {
      expect(screen.getByText(/选择已有 volume/)).toBeDefined()
    })
    expect(mockListVolumes).toHaveBeenCalledTimes(1)
  })

  it('shows error alert when API fails', async () => {
    mockListVolumes.mockRejectedValue(new Error('network'))
    render(
      <VolumePicker open value="" onChange={vi.fn()} onClose={vi.fn()} />
    )
    await waitFor(() => {
      expect(screen.getByText('加载 Docker volumes 失败')).toBeDefined()
    })
  })

  it('calls onChange with custom input on OK', async () => {
    mockListVolumes.mockResolvedValue({ data: volumes } as any)
    const onChange = vi.fn()
    const onClose = vi.fn()
    render(
      <VolumePicker open value="" onChange={onChange} onClose={onClose} />
    )
    await waitFor(() => screen.queryByText('加载 Docker volumes 失败') === null)

    const input = screen.getByPlaceholderText(/mysql-data-ssd/)
    fireEvent.change(input, { target: { value: 'my-new-vol' } })

    fireEvent.click(screen.getByRole('button', { name: /确\s*认/ }))
    expect(onChange).toHaveBeenCalledWith('my-new-vol')
    expect(onClose).toHaveBeenCalled()
  })

  it('does not corrupt parent value when modal is cancelled mid-typing', async () => {
    mockListVolumes.mockResolvedValue({ data: volumes } as any)
    const onChange = vi.fn()
    const onClose = vi.fn()
    render(
      <VolumePicker open value="original-vol" onChange={onChange} onClose={onClose} />
    )
    await waitFor(() => screen.queryByText('加载 Docker volumes 失败') === null)

    const input = screen.getByPlaceholderText(/mysql-data-ssd/)
    fireEvent.change(input, { target: { value: 'partial-input' } })

    // Cancel without confirming
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }))
    // onChange should NOT have been called — parent state is intact
    expect(onChange).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when cancelled', async () => {
    mockListVolumes.mockResolvedValue({ data: [] } as any)
    const onClose = vi.fn()
    render(
      <VolumePicker open value="" onChange={vi.fn()} onClose={onClose} />
    )
    await waitFor(() => {})
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }))
    expect(onClose).toHaveBeenCalled()
  })
})
