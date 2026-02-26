import { useState, useEffect } from 'react';
import { Modal, Spin, Descriptions, Tag, Empty } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { listHerbs } from '../api/herb';
import type { HerbItem } from '../api/herb';

interface HerbDetailModalProps {
  open: boolean;
  herbName: string;
  onClose: () => void;
}

export default function HerbDetailModal({ open, herbName, onClose }: HerbDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [herb, setHerb] = useState<HerbItem | null>(null);

  useEffect(() => {
    if (!open || !herbName) return;
    setLoading(true);
    setHerb(null);
    listHerbs({ name: herbName, page: 1, size: 10 })
      .then((res) => {
        const body = res as unknown as { data: { list: HerbItem[]; total: number } };
        const list = body.data.list || [];
        // 精确匹配优先，否则取第一个
        const exact = list.find((h) => h.name === herbName);
        setHerb(exact || list[0] || null);
      })
      .catch(() => {
        setHerb(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, herbName]);

  return (
    <Modal
      title={`${herbName} - 中药详情`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnClose
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin tip="查询中..." />
        </div>
      ) : herb ? (
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="药名">{herb.name}</Descriptions.Item>
          <Descriptions.Item label="别名">{herb.alias || '无'}</Descriptions.Item>
          <Descriptions.Item label="分类">{herb.category || '无'}</Descriptions.Item>
          <Descriptions.Item label="性味归经">{herb.properties || '无'}</Descriptions.Item>
          <Descriptions.Item label="功效">{herb.effects || '无'}</Descriptions.Item>
          <Descriptions.Item label="主治">{herb.indications || '无'}</Descriptions.Item>
          <Descriptions.Item label="道地产区">{herb.origin || '无'}</Descriptions.Item>
          <Descriptions.Item label="来源">
            {herb.source === 'deepseek' ? (
              <Tag icon={<RobotOutlined />} color="blue">
                DeepSeek AI（仅供参考）
              </Tag>
            ) : (
              <Tag color="green">本地</Tag>
            )}
          </Descriptions.Item>
        </Descriptions>
      ) : (
        <Empty description={`未找到「${herbName}」的详细信息`} />
      )}
    </Modal>
  );
}
