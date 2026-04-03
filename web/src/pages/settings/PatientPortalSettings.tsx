import { useEffect, useState } from 'react';
import { Card, Switch, message, Spin, Typography, Alert } from 'antd';
import { getPatientPortalConfig, updatePatientPortalConfig } from '../../api/patientPortal';
import type { PatientPortalConfig } from '../../api/patientPortal';

const { Title } = Typography;

const SWITCHES = [
  { key: 'login_enabled' as keyof PatientPortalConfig, label: '开放患者登录', desc: '关闭后患者端所有功能不可用', icon: '🔑', section: '账号管理' },
  { key: 'register_enabled' as keyof PatientPortalConfig, label: '开放患者注册', desc: '关闭后只允许已注册患者登录，新用户无法注册', icon: '📝', section: '账号管理' },
  { key: 'appointment_enabled' as keyof PatientPortalConfig, label: '开放在线预约', desc: '患者可自助预约医生时段', icon: '📅', section: '就诊功能' },
  { key: 'queue_enabled' as keyof PatientPortalConfig, label: '开放快捷取号', desc: '患者到院后可自助取号入队', icon: '🎫', section: '就诊功能' },
  { key: 'records_enabled' as keyof PatientPortalConfig, label: '开放病历与收费查看', desc: '患者可查看自己的病历、处方、账单（只读）', icon: '📋', section: '记录查看' },
];

export default function PatientPortalSettings() {
  const [config, setConfig] = useState<PatientPortalConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPatientPortalConfig()
      .then((res) => setConfig(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (key: keyof PatientPortalConfig, value: boolean) => {
    if (!config) return;
    const updated = { ...config, [key]: value };
    setConfig(updated);
    try {
      await updatePatientPortalConfig(updated);
      message.success('已保存');
    } catch {
      setConfig(config); // revert on error
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;
  if (!config) return null;

  const sections = [...new Set(SWITCHES.map(s => s.section))];

  return (
    <div style={{ padding: '24px', maxWidth: 600 }}>
      <Title level={4}>患者端管理</Title>
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        message="以下开关仅影响患者端，不影响诊所员工的管理后台功能"
        showIcon
      />
      {sections.map(section => (
        <Card key={section} title={section} size="small" style={{ marginBottom: 12 }}>
          {SWITCHES.filter(s => s.section === section).map(sw => (
            <div
              key={sw.key}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 0', borderBottom: '1px solid #f9f9f9',
              }}
            >
              <span style={{ fontSize: 20 }}>{sw.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{sw.label}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{sw.desc}</div>
              </div>
              <Switch
                checked={config[sw.key] as boolean}
                onChange={(v) => handleToggle(sw.key, v)}
                style={{ background: (config[sw.key] as boolean) ? '#52C41A' : undefined }}
              />
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
