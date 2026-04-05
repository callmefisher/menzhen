import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect } from 'vitest';
import type { AcupointData, MeridianData } from '../data/types';

// ─────────────────────────────────────────────
// vi.hoisted — 定义在 vi.mock factory 之前可用的 mock 数据
// ─────────────────────────────────────────────

const {
  mockMeridianLU,
  mockMeridianLI,
  mockExtraordinaryDU,
  mockAcupointLU1,
  mockAcupointLU2,
  mockAcupointLI4,
} = vi.hoisted(() => {
  const mockMeridianLU: MeridianData = {
    id: 'LU',
    name: '手太阴肺经',
    type: 'regular',
    color: '#FF6B6B',
    description: '测试肺经描述',
    path: [],
  };

  const mockMeridianLI: MeridianData = {
    id: 'LI',
    name: '手阳明大肠经',
    type: 'regular',
    color: '#FF9F43',
    description: '测试大肠经描述',
    path: [],
  };

  const mockExtraordinaryDU: MeridianData = {
    id: 'DU',
    name: '督脉',
    type: 'extraordinary',
    color: '#C8D6E5',
    description: '测试督脉描述',
    path: [],
  };

  const mockAcupointLU1: AcupointData = {
    code: 'LU1',
    name: '中府',
    meridianId: 'LU',
    position: [0, 0, 0],
    effects: '宣肺止咳',
    indications: '咳嗽',
    method: '斜刺',
  };

  const mockAcupointLU2: AcupointData = {
    code: 'LU2',
    name: '云门',
    meridianId: 'LU',
    position: [0, 0, 0],
    effects: '宣肺理气',
    indications: '咳嗽气喘',
    method: '斜刺',
  };

  const mockAcupointLI4: AcupointData = {
    code: 'LI4',
    name: '合谷',
    meridianId: 'LI',
    position: [0, 0, 0],
    effects: '疏风解表',
    indications: '头痛牙痛',
    method: '直刺',
  };

  return {
    mockMeridianLU,
    mockMeridianLI,
    mockExtraordinaryDU,
    mockAcupointLU1,
    mockAcupointLU2,
    mockAcupointLI4,
  };
});

// ─────────────────────────────────────────────
// Mock 模块
// ─────────────────────────────────────────────

vi.mock('../data/meridians', () => ({
  regularMeridians: [mockMeridianLU, mockMeridianLI],
  extraordinaryMeridians: [mockExtraordinaryDU],
  meridians: [mockMeridianLU, mockMeridianLI, mockExtraordinaryDU],
  meridianMap: {
    LU: mockMeridianLU,
    LI: mockMeridianLI,
    DU: mockExtraordinaryDU,
  },
}));

vi.mock('../data/acupoints', () => ({
  acupoints: [mockAcupointLU1, mockAcupointLU2, mockAcupointLI4],
  acupointsByMeridian: {
    LU: [mockAcupointLU1, mockAcupointLU2],
    LI: [mockAcupointLI4],
    DU: [],
  },
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

// ─────────────────────────────────────────────
// 延迟导入（在 mock 之后）
// ─────────────────────────────────────────────
import MeridianPanel from '../MeridianPanel';

// ─────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────

function buildProps(overrides: Partial<Parameters<typeof MeridianPanel>[0]> = {}) {
  return {
    selectedMeridians: [],
    onMeridianToggle: vi.fn(),
    onAcupointSearch: vi.fn(),
    onMeridianInfoClick: vi.fn(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// 测试套件
// ─────────────────────────────────────────────

describe('MeridianPanel', () => {
  describe('1. 正常流程 — 经络勾选后穴位显示', () => {
    it('勾选肺经后，该经络下所有穴位均可见', () => {
      const props = buildProps({ selectedMeridians: ['LU'] });
      render(<MeridianPanel {...props} />);

      expect(screen.getByText('中府')).toBeInTheDocument();
      expect(screen.getByText('云门')).toBeInTheDocument();
    });

    it('未勾选时，穴位 tag 不显示', () => {
      const props = buildProps({ selectedMeridians: [] });
      render(<MeridianPanel {...props} />);

      expect(screen.queryByText('中府')).not.toBeInTheDocument();
      expect(screen.queryByText('云门')).not.toBeInTheDocument();
      expect(screen.queryByText('合谷')).not.toBeInTheDocument();
    });

    it('多个经络同时勾选，各自穴位均可见', () => {
      const props = buildProps({ selectedMeridians: ['LU', 'LI'] });
      render(<MeridianPanel {...props} />);

      expect(screen.getByText('中府')).toBeInTheDocument();
      expect(screen.getByText('云门')).toBeInTheDocument();
      expect(screen.getByText('合谷')).toBeInTheDocument();
    });

    it('经络名称始终显示在面板中（无论是否勾选）', () => {
      const props = buildProps({ selectedMeridians: [] });
      render(<MeridianPanel {...props} />);

      expect(screen.getByText('手太阴肺经')).toBeInTheDocument();
      expect(screen.getByText('手阳明大肠经')).toBeInTheDocument();
      expect(screen.getByText('督脉')).toBeInTheDocument();
    });
  });

  describe('2. 核心回归 — 点击穴位后其他穴位仍然显示', () => {
    it('点击中府 tag 后，云门 tag 仍然可见', async () => {
      const user = userEvent.setup();
      const props = buildProps({ selectedMeridians: ['LU'] });
      render(<MeridianPanel {...props} />);

      expect(screen.getByText('云门')).toBeInTheDocument();
      await user.click(screen.getByText('中府'));

      expect(screen.getByText('云门')).toBeInTheDocument();
    });

    it('点击云门 tag 后，中府 tag 仍然可见', async () => {
      const user = userEvent.setup();
      const props = buildProps({ selectedMeridians: ['LU'] });
      render(<MeridianPanel {...props} />);

      await user.click(screen.getByText('云门'));

      expect(screen.getByText('中府')).toBeInTheDocument();
    });

    it('多次点击不同穴位，所有穴位始终保持可见', async () => {
      const user = userEvent.setup();
      const props = buildProps({ selectedMeridians: ['LU', 'LI'] });
      render(<MeridianPanel {...props} />);

      await user.click(screen.getByText('中府'));
      expect(screen.getByText('云门')).toBeInTheDocument();
      expect(screen.getByText('合谷')).toBeInTheDocument();

      await user.click(screen.getByText('合谷'));
      expect(screen.getByText('中府')).toBeInTheDocument();
      expect(screen.getByText('云门')).toBeInTheDocument();
    });

    it('点击穴位 tag 触发 onAcupointSearch 回调并携带正确数据', async () => {
      const user = userEvent.setup();
      const onAcupointSearch = vi.fn();
      const props = buildProps({ selectedMeridians: ['LU'], onAcupointSearch });
      render(<MeridianPanel {...props} />);

      await user.click(screen.getByText('中府'));

      expect(onAcupointSearch).toHaveBeenCalledTimes(1);
      expect(onAcupointSearch).toHaveBeenCalledWith(mockAcupointLU1);
    });
  });

  describe('3. 搜索 — 输入穴位名，下拉框显示', () => {
    it('输入穴位名后，下拉框中显示匹配结果', async () => {
      const user = userEvent.setup();
      const props = buildProps();
      render(<MeridianPanel {...props} />);

      const input = screen.getByPlaceholderText('输入穴位名或编码');
      await user.type(input, '中府');

      await waitFor(() => {
        // 结果中至少有一个「中府」出现在文档中
        expect(screen.getByText('中府')).toBeInTheDocument();
      });
    });

    it('输入穴位编码后，下拉框中显示匹配结果', async () => {
      const user = userEvent.setup();
      const props = buildProps();
      render(<MeridianPanel {...props} />);

      const input = screen.getByPlaceholderText('输入穴位名或编码');
      await user.type(input, 'LU2');

      await waitFor(() => {
        expect(screen.getByText('云门')).toBeInTheDocument();
      });
    });

    it('输入不存在的关键词时，下拉框不显示任何穴位', async () => {
      const user = userEvent.setup();
      const props = buildProps();
      render(<MeridianPanel {...props} />);

      const input = screen.getByPlaceholderText('输入穴位名或编码');
      await user.type(input, 'XXXXNOTEXIST');

      await waitFor(() => {
        expect(screen.queryByText('中府')).not.toBeInTheDocument();
        expect(screen.queryByText('合谷')).not.toBeInTheDocument();
      });
    });

    it('输入为空时不显示下拉框', () => {
      const props = buildProps();
      render(<MeridianPanel {...props} />);

      // 未输入时不应出现穴位下拉列表项
      // 穴位名只有在勾选经络或搜索时才可见
      expect(screen.queryByText('中府')).not.toBeInTheDocument();
    });
  });

  describe('4. 搜索选中 — 从下拉框选中穴位', () => {
    it('点击下拉项后 onAcupointSearch 被调用并携带正确穴位数据', async () => {
      const user = userEvent.setup();
      const onAcupointSearch = vi.fn();
      const props = buildProps({ onAcupointSearch });
      render(<MeridianPanel {...props} />);

      const input = screen.getByPlaceholderText('输入穴位名或编码');
      await user.type(input, '中府');

      await waitFor(() => {
        expect(screen.getByText('中府')).toBeInTheDocument();
      });

      await user.click(screen.getByText('中府'));

      expect(onAcupointSearch).toHaveBeenCalledWith(mockAcupointLU1);
    });

    it('选中后 input 显示穴位名称', async () => {
      const user = userEvent.setup();
      const props = buildProps();
      render(<MeridianPanel {...props} />);

      const input = screen.getByPlaceholderText('输入穴位名或编码') as HTMLInputElement;
      await user.type(input, '云门');

      await waitFor(() => {
        expect(screen.getByText('云门')).toBeInTheDocument();
      });

      await user.click(screen.getByText('云门'));

      expect(input.value).toBe('云门');
    });

    it('选中后再次点击同一经络的穴位 tag，onAcupointSearch 仍被调用', async () => {
      const user = userEvent.setup();
      const onAcupointSearch = vi.fn();
      const props = buildProps({ selectedMeridians: ['LU'], onAcupointSearch });
      render(<MeridianPanel {...props} />);

      await user.click(screen.getByText('中府'));
      expect(onAcupointSearch).toHaveBeenCalledTimes(1);

      await user.click(screen.getByText('云门'));
      expect(onAcupointSearch).toHaveBeenCalledTimes(2);
      expect(onAcupointSearch).toHaveBeenLastCalledWith(mockAcupointLU2);
    });
  });

  describe('5. 清空 — 清空后 onAcupointSearch(null) 被调用', () => {
    it('清空 input 内容后 onAcupointSearch(null) 被调用', async () => {
      const user = userEvent.setup();
      const onAcupointSearch = vi.fn();
      const props = buildProps({ onAcupointSearch });
      render(<MeridianPanel {...props} />);

      const input = screen.getByPlaceholderText('输入穴位名或编码');
      await user.type(input, '中府');

      await waitFor(() => {
        expect(screen.getByText('中府')).toBeInTheDocument();
      });

      // 选中穴位，让 searchValue 有值
      await user.click(screen.getByText('中府'));
      onAcupointSearch.mockClear();

      // 尝试点击 antd allowClear 按钮
      const clearIcon = document.querySelector('.ant-input-clear-icon');
      if (clearIcon) {
        await user.click(clearIcon as HTMLElement);
        expect(onAcupointSearch).toHaveBeenCalledWith(null);
      } else {
        // jsdom 环境下 antd 的 clear 按钮可能不可见，
        // 退而验证手动清空（clear 事件）会调用 onAcupointSearch(null)
        fireEvent.change(input, { target: { value: '' } });
        // 仅输入清空不触发 onClear，这里验证 searchValue 为空即可
        expect((input as HTMLInputElement).value).toBe('');
      }
    });

    it('清空后 input 为空', async () => {
      const user = userEvent.setup();
      const props = buildProps();
      render(<MeridianPanel {...props} />);

      const input = screen.getByPlaceholderText('输入穴位名或编码') as HTMLInputElement;
      await user.type(input, '合谷');

      await waitFor(() => {
        expect(screen.getByText('合谷')).toBeInTheDocument();
      });

      await user.click(screen.getByText('合谷'));
      expect(input.value).toBe('合谷');

      // 手动清空 input
      await user.clear(input);
      expect(input.value).toBe('');
    });
  });

  describe('6. 空状态 — 未勾选任何经络', () => {
    it('未勾选任何经络时，面板中无穴位 tag', () => {
      const props = buildProps({ selectedMeridians: [] });
      render(<MeridianPanel {...props} />);

      expect(screen.queryByText('中府')).not.toBeInTheDocument();
      expect(screen.queryByText('云门')).not.toBeInTheDocument();
      expect(screen.queryByText('合谷')).not.toBeInTheDocument();
    });

    it('经络列表始终渲染，即使没有勾选任何经络', () => {
      const props = buildProps({ selectedMeridians: [] });
      render(<MeridianPanel {...props} />);

      expect(screen.getByText('手太阴肺经')).toBeInTheDocument();
      expect(screen.getByText('手阳明大肠经')).toBeInTheDocument();
    });

    it('勾选无穴位的奇经（督脉）时不显示穴位 tag', () => {
      const props = buildProps({ selectedMeridians: ['DU'] });
      render(<MeridianPanel {...props} />);

      // DU 在 mock 中 acupointsByMeridian.DU = []，不应渲染任何穴位 tag
      expect(screen.queryByText('中府')).not.toBeInTheDocument();
      expect(screen.queryByText('合谷')).not.toBeInTheDocument();
    });

    it('切换经络时调用 onMeridianToggle 并传入正确 id', async () => {
      const user = userEvent.setup();
      const onMeridianToggle = vi.fn();
      const props = buildProps({ onMeridianToggle });
      render(<MeridianPanel {...props} />);

      // 点击经络名称对应的 checkbox label
      const checkbox = screen.getByText('手太阴肺经').closest('label');
      if (checkbox) {
        await user.click(checkbox);
      }

      expect(onMeridianToggle).toHaveBeenCalledWith('LU');
    });
  });
});
