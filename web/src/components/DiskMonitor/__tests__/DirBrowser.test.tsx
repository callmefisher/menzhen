import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import DirBrowser from '../DirBrowser'
import * as diskApi from '../../../api/disk'

vi.mock('../../../api/disk')

describe('DirBrowser', () => {
  const mockBrowse = vi.mocked(diskApi.browseFS)

  beforeEach(() => {
    vi.clearAllMocks()
    mockBrowse.mockResolvedValue({
      data: {
        code: 0,
        data: [
          { name: 'opt', path: '/opt', is_dir: true },
          { name: 'data', path: '/data', is_dir: true },
        ],
      },
    } as any)
  })

  it('renders directory list when open', async () => {
    render(<DirBrowser open onSelect={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('opt')).toBeInTheDocument())
    expect(screen.getByText('data')).toBeInTheDocument()
  })

  it('navigates into a subdirectory on click', async () => {
    render(<DirBrowser open onSelect={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('opt'))
    fireEvent.click(screen.getByText('opt'))
    await waitFor(() => expect(mockBrowse).toHaveBeenCalledWith('/opt'))
  })

  it('calls onSelect with current path when OK clicked', async () => {
    const onSelect = vi.fn()
    render(<DirBrowser open onSelect={onSelect} onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('opt'))
    fireEvent.click(screen.getByText('opt'))
    // After clicking opt, current path is /opt — click modal OK
    await waitFor(() => expect(mockBrowse).toHaveBeenCalledWith('/opt'))
    // The "选择此目录" button is the modal's OK button
    fireEvent.click(screen.getByText('选择此目录'))
    expect(onSelect).toHaveBeenCalledWith('/opt')
  })
})
