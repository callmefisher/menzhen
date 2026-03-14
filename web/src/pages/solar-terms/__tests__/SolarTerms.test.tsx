import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import SolarTerms from '../SolarTerms';

// Mock auth
vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    hasPermission: () => true,
  }),
}));

// Mock useIsMobile
vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

const mockTerms = Array.from({ length: 24 }, (_, i) => {
  const names = [
    '立春','雨水','惊蛰','春分','清明','谷雨',
    '立夏','小满','芒种','夏至','小暑','大暑',
    '立秋','处暑','白露','秋分','寒露','霜降',
    '立冬','小雪','大雪','冬至','小寒','大寒',
  ];
  const seasons = ['春','春','春','春','春','春','夏','夏','夏','夏','夏','夏','秋','秋','秋','秋','秋','秋','冬','冬','冬','冬','冬','冬'];
  const months = [2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,1,1];
  const days = [3,18,5,20,4,19,5,20,5,21,6,22,7,22,7,22,8,23,7,22,6,21,5,20];
  const endMonths = [2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,1,1,2];
  const endDays = [18,5,20,4,19,5,20,5,21,6,22,7,22,7,22,8,23,7,22,6,21,5,20,3];
  return {
    id: i + 1,
    name: names[i],
    season: seasons[i],
    order_index: i + 1,
    month: months[i],
    day: days[i],
    end_month: endMonths[i],
    end_day: endDays[i],
    content: i === 2 ? '## 养生原则\n惊蛰时节宜养肝。' : '',
    created_at: '2026-03-14T00:00:00Z',
    updated_at: '2026-03-14T00:00:00Z',
  };
});

// Mock API
vi.mock('../../../api/solarTerm', () => ({
  listSolarTerms: vi.fn(() => Promise.resolve({ code: 0, data: mockTerms })),
  updateSolarTerm: vi.fn(() => Promise.resolve({ code: 0 })),
  deleteSolarTermContent: vi.fn(() => Promise.resolve({ code: 0 })),
}));

function renderPage() {
  return render(
    <BrowserRouter>
      <SolarTerms />
    </BrowserRouter>
  );
}

describe('SolarTerms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title and SVG ring', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('二十四节气')).toBeInTheDocument();
    });
    // SVG should be present
    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('displays all 24 solar terms as dots', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('二十四节气')).toBeInTheDocument();
    });
    // There should be circles in the SVG (at least 24 visible dots)
    const circles = document.querySelectorAll('svg circle');
    expect(circles.length).toBeGreaterThan(24);
  });

  it('shows current term info in center', async () => {
    renderPage();
    await waitFor(() => {
      // Center should show "第 X / 24 节气"
      expect(screen.getByText(/第 \d+ \/ 24 节气/)).toBeInTheDocument();
    });
  });

  it('auto-opens drawer for current term on load', async () => {
    renderPage();
    await waitFor(() => {
      // Drawer should open automatically with current term's name visible
      // The drawer header shows the term name
      const drawerContent = document.querySelector('.ant-drawer');
      expect(drawerContent).toBeInTheDocument();
    });
  });

  it('shows content in drawer for term with content', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('二十四节气')).toBeInTheDocument();
    });

    // Find and click 惊蛰 (which has content)
    const jingzheText = screen.getAllByText('惊蛰');
    if (jingzheText.length > 0) {
      // Click on the SVG text label for 惊蛰
      fireEvent.click(jingzheText[0]);
    }

    await waitFor(() => {
      // The markdown content should render
      expect(screen.getByText(/养生原则/)).toBeInTheDocument();
    });
  });

  it('shows empty state for term without content', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('二十四节气')).toBeInTheDocument();
    });

    // Find 立春 (has no content)
    const lichunTexts = screen.getAllByText('立春');
    if (lichunTexts.length > 0) {
      fireEvent.click(lichunTexts[0]);
    }

    await waitFor(() => {
      expect(screen.getByText('暂无养生内容')).toBeInTheDocument();
    });
  });

  it('shows edit and delete buttons for admin', async () => {
    renderPage();
    await waitFor(() => {
      // Drawer auto-opens for current term — buttons should be visible
      expect(screen.getByText('编辑')).toBeInTheDocument();
      expect(screen.getByText('删除')).toBeInTheDocument();
    });
  });

  it('renders edit and delete buttons in drawer', async () => {
    renderPage();
    // Wait for drawer to auto-open with admin action buttons
    const editBtn = await screen.findByText('编辑');
    const deleteBtn = await screen.findByText('删除');
    expect(editBtn).toBeInTheDocument();
    expect(deleteBtn).toBeInTheDocument();
  });
});
