import { useState } from 'react';
import { Typography } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;

export default function NotesPanel() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Toggle tab */}
      <div
        onClick={() => setOpen(!open)}
        style={{
          position: 'fixed',
          right: open ? 420 : 0,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 1000,
          width: 28,
          height: 80,
          background: 'linear-gradient(180deg, #8b6914 0%, #6b4e0a 100%)',
          borderRadius: '8px 0 0 8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '-2px 0 8px rgba(0,0,0,0.15)',
          transition: 'right 0.3s ease',
          writingMode: 'vertical-rl',
          color: '#f5e6c8',
          fontSize: 13,
          letterSpacing: 4,
          userSelect: 'none',
        }}
      >
        {open ? <RightOutlined style={{ fontSize: 12 }} /> : (
          <>
            <LeftOutlined style={{ fontSize: 10, marginBottom: 6 }} />
            <span>笔记</span>
          </>
        )}
      </div>

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          right: open ? 0 : -420,
          top: 0,
          width: 420,
          height: '100vh',
          zIndex: 999,
          background: 'linear-gradient(135deg, #fdf8ef 0%, #f9f0e0 50%, #f5e8d0 100%)',
          boxShadow: open ? '-4px 0 20px rgba(0,0,0,0.12)' : 'none',
          transition: 'right 0.3s ease',
          overflowY: 'auto',
          borderLeft: '1px solid #d4b876',
        }}
      >
        <div style={{ padding: '28px 24px 40px' }}>
          {/* Title */}
          <Title level={4} style={{
            color: '#6b4e0a',
            textAlign: 'center',
            marginBottom: 24,
            fontFamily: 'serif',
          }}>
            五运六气 · 运气关系
          </Title>

          <Paragraph style={{ color: '#5a4a30', lineHeight: 2, fontSize: 14, marginBottom: 24 }}>
            理论是如何模拟天、人、物候之间复杂互动的。下面梳理三层关系，并结合2026丙午年的例子来解释。
          </Paragraph>

          {/* 第一层 */}
          <section style={{ marginBottom: 28 }}>
            <Title level={5} style={{
              color: '#6b4e0a',
              borderBottom: '2px solid #d4b876',
              paddingBottom: 8,
              marginBottom: 16,
              fontFamily: 'serif',
            }}>
              第一层：岁运、主运、客运
            </Title>
            <Paragraph style={{ color: '#7a6940', fontStyle: 'italic', fontSize: 13, marginBottom: 14 }}>
              可以想象成"基调、背景板与变奏曲"
            </Paragraph>

            {/* 岁运 */}
            <div style={cardStyle}>
              <Text strong style={labelStyle}>岁运（统管全年，决定"基调"）</Text>
              <Paragraph style={bodyStyle}>
                <Text strong>定义：</Text>岁运又叫"中运"或"大运"，是主管全年气候的五行力量。它是全年的总指挥，决定了这一年气候的大方向是偏寒、偏热、偏湿还是偏燥。
              </Paragraph>
              <Paragraph style={{ ...bodyStyle, marginBottom: 0 }}>
                <Text strong>作用：</Text>它是一个纲领性的存在。2026年是丙午年，天干为丙，丙辛化水，阳干为太过。所以岁运是<Text style={highlightStyle}>"水运太过"</Text>。这给全年定下了基调：寒气流行。尽管有四季变化，但这一年的"底色"会比平常年份要寒凉一些。
              </Paragraph>
            </div>

            {/* 主运 */}
            <div style={cardStyle}>
              <Text strong style={labelStyle}>主运（固定不变的"背景板"）</Text>
              <Paragraph style={bodyStyle}>
                <Text strong>定义：</Text>主运是把一年分为五个阶段（初运、二运、三运、四运、终运），分别用木、火、土、金、水来表示。顺序永远固定，始于木，终于水，反映春生、夏长、长夏化、秋收、冬藏的规律。
              </Paragraph>
              <Paragraph style={{ ...bodyStyle, marginBottom: 0 }}>
                <Text strong>作用：</Text>一个基本的、不会改变的背景框架。无论哪一年，初运都是"木"（主风），三运都是"土"（主湿），终运都是"水"（主寒）。代表了常态的季节更替。
              </Paragraph>
            </div>

            {/* 客运 */}
            <div style={cardStyle}>
              <Text strong style={labelStyle}>客运（叠加的"变奏曲"）</Text>
              <Paragraph style={bodyStyle}>
                <Text strong>定义：</Text>客运同样分五个阶段，按五行相生的顺序走，但起点由当年岁运决定。
              </Paragraph>
              <Paragraph style={{ ...bodyStyle, marginBottom: 0 }}>
                <Text strong>作用：</Text>在固定的背景板上，额外叠加一层变化的力量。2026年岁运是"水运太过"，客运从"水"开始（初运是太羽水），然后按水→木→火→土→金走下去。每个阶段，除了固定的主运力量（如初运的风），还叠加一层由岁运带来的特定力量（如初运的寒）。
              </Paragraph>
            </div>

            {/* 小结 */}
            <div style={summaryStyle}>
              <Text style={{ fontSize: 13, color: '#6b4e0a' }}>
                <strong>小结：</strong>岁运（水运太过）决定全年客运的起点 → 主运（木火土金水）是不变的背景 → 客运（水木火土金）是在背景上流动变化的旋律，把岁运的影响力贯穿到五个阶段中去。
              </Text>
            </div>
          </section>

          {/* 第二层 */}
          <section style={{ marginBottom: 28 }}>
            <Title level={5} style={{
              color: '#6b4e0a',
              borderBottom: '2px solid #d4b876',
              paddingBottom: 8,
              marginBottom: 16,
              fontFamily: 'serif',
            }}>
              第二层：运与气的关系
            </Title>
            <Paragraph style={{ color: '#5a4a30', lineHeight: 2, fontSize: 14, marginBottom: 14 }}>
              这是五运六气理论中最精彩也最复杂的部分。运（五运）代表地球自身的变化规律，气（六气）代表天体（主要是太阳和五大行星）对地球施加的力量。两者相遇，会发生生、克、同化等关系，产生复杂的气候变化。
            </Paragraph>

            {/* 生克关系 */}
            <div style={cardStyle}>
              <Text strong style={{ ...labelStyle, marginBottom: 12 }}>运与气的相互作用（生克关系）</Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: '气生运（顺化）', desc: '客气（天之气）去生五运（地之气）。天气主动滋养地气，气候调和，是平和之年。' },
                  { label: '运生气（小逆）', desc: '五运（地之气）去生客气（天之气）。地气向天气输送能量，虽也是顺，但不如"气生运"和谐，变化会多一些。' },
                  { label: '气克运（天刑）', desc: '客气（天之气）去克制五运（地之气）。天气对地气压制很强，气候变化剧烈、反常。' },
                  { label: '运克气（不和）', desc: '五运（地之气）去克制客气（天之气）。地气反抗天气，导致气候不协调。' },
                  { label: '运气相同（天符/岁会）', desc: '五运和六气五行属性一致时，力量叠加。如2026年终之气客气太阳寒水与水运太过叠加，寒上加寒。' },
                ].map(item => (
                  <div key={item.label}>
                    <Text style={tagStyle}>{item.label}</Text>
                    <Text style={{ fontSize: 13, color: '#5a4a30', display: 'block', marginTop: 4, paddingLeft: 2, lineHeight: 1.8 }}>
                      {item.desc}
                    </Text>
                  </div>
                ))}
              </div>
            </div>

            {/* 盛衰与胜负 */}
            <div style={cardStyle}>
              <Text strong style={{ ...labelStyle, marginBottom: 12 }}>运气的盛衰与胜负</Text>
              <Paragraph style={bodyStyle}>
                <Text strong>太过与不及：</Text>2026年岁运是"水运太过"，水本身的力量很强。但上半年是"少阴君火司天"（火气主事），火是水的"所胜"（水克火），形成复杂的对峙局面。
              </Paragraph>
              <Paragraph style={{ ...bodyStyle, marginBottom: 0 }}>
                <Text strong>郁发：</Text>当一种力量被过于强大的力量压制时（比如司天的火气被太过的水运压制），可能在某个时间点"郁极而发"，突然爆发出来，造成剧烈的气候反常。比如本该热的时候反而很冷，或者突然出现极端高温。
              </Paragraph>
            </div>

            {/* 总结比喻 */}
            <div style={summaryStyle}>
              <Text style={{ fontSize: 13, color: '#6b4e0a' }}>
                <strong>总结：</strong>"运"代表地球内部五行气化的升降沉浮，"气"代表天气（司天、在泉）的加临与影响。两者的关系，就像<Text style={highlightStyle}>本地市场的供需规律（运）</Text>和<Text style={highlightStyle}>国家宏观调控政策（气）</Text>之间的互动。政策顺应市场（气生运），市场平稳；政策强行干预（气克运），市场波动剧烈。
              </Text>
            </div>
          </section>

          {/* 2026 示例 */}
          <section>
            <Title level={5} style={{
              color: '#6b4e0a',
              borderBottom: '2px solid #d4b876',
              paddingBottom: 8,
              marginBottom: 16,
              fontFamily: 'serif',
            }}>
              2026 丙午年 应用示例
            </Title>

            <div style={{
              background: 'linear-gradient(135deg, rgba(139,105,20,0.08), rgba(139,105,20,0.03))',
              borderRadius: 8,
              padding: '16px 18px',
              border: '1px solid #d4b876',
            }}>
              <div style={{ marginBottom: 14 }}>
                <Text strong style={{ fontSize: 14, color: '#8b6914' }}>全年：</Text>
                <Paragraph style={{ ...bodyStyle, marginTop: 4, marginBottom: 0 }}>
                  岁运（水太过）的"寒"与司天（少阴君火）的"热"形成一对基本矛盾。全年可能呈现出寒热交争、气候剧烈波动的特点。
                </Paragraph>
              </div>
              <div>
                <Text strong style={{ fontSize: 14, color: '#8b6914' }}>三之气（5.21 — 7.23）：</Text>
                <Paragraph style={{ ...bodyStyle, marginTop: 4, marginBottom: 0 }}>
                  主气是少阳相火（热），客气是少阴君火（热），再加上司天（也是少阴君火）主政。此时，气的力量（三把火）完全压倒运的力量（水），所以在这段时间，天气会异常炎热，之前被压制的火气会猛烈爆发。
                </Paragraph>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.6)',
  borderRadius: 8,
  padding: '14px 16px',
  marginBottom: 12,
  border: '1px solid #e0d2b4',
};

const labelStyle: React.CSSProperties = {
  fontSize: 14,
  color: '#8b6914',
  display: 'block',
  marginBottom: 8,
};

const bodyStyle: React.CSSProperties = {
  color: '#5a4a30',
  lineHeight: 2,
  fontSize: 13,
  marginBottom: 8,
};

const highlightStyle: React.CSSProperties = {
  color: '#8b6914',
  fontWeight: 600,
};

const tagStyle: React.CSSProperties = {
  fontSize: 12,
  background: '#d4b876',
  color: '#fff',
  padding: '2px 8px',
  borderRadius: 4,
  whiteSpace: 'nowrap',
};

const summaryStyle: React.CSSProperties = {
  background: '#f0e6ce',
  borderRadius: 6,
  padding: '10px 14px',
  borderLeft: '3px solid #d4b876',
  marginTop: 4,
};
