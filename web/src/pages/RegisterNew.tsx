import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { message } from 'antd';
import { register } from '../api/auth';
import LoginBackground from './LoginBackground';

export default function RegisterNew() {
  const [tenantCode, setTenantCode] = useState('default');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [realName, setRealName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmErr, setConfirmErr] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setConfirmErr('两次输入的密码不一致');
      return;
    }
    if (password.length < 6) {
      setConfirmErr('密码至少 6 个字符');
      return;
    }
    setConfirmErr('');
    setLoading(true);
    try {
      await register({
        tenant_code: tenantCode,
        username,
        password,
        real_name: realName,
        phone: phone || '',
      });
      message.success('注册成功，请登录');
      navigate('/login', { replace: true });
    } catch {
      // Error is already handled by the request interceptor (message.error)
    } finally {
      setLoading(false);
    }
  };

  return (
    <LoginBackground>
      <div className="lp-fheader">
        <h2>创建账号</h2>
        <p>填写以下信息完成注册</p>
      </div>
      <form onSubmit={handleSubmit} className="lp-regform">
        {/* 诊所编码 */}
        <div className="lp-fg">
          <label className="lp-fl">诊所编码</label>
          <div className="lp-iw">
            <input
              type="text"
              className="lp-fi"
              placeholder="诊所编码（默认：default）"
              required
              value={tenantCode}
              onChange={e => setTenantCode(e.target.value)}
            />
            <svg className="lp-ii" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
        </div>

        {/* 用户名 */}
        <div className="lp-fg">
          <label className="lp-fl">用户名</label>
          <div className="lp-iw">
            <input
              type="text"
              className="lp-fi"
              placeholder="请输入用户名"
              autoComplete="off"
              required
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
            <svg className="lp-ii" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
        </div>

        {/* 密码 */}
        <div className="lp-fg">
          <label className="lp-fl">密码</label>
          <div className="lp-iw">
            <input
              type="password"
              className="lp-fi"
              placeholder="密码（至少 6 位）"
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            <svg className="lp-ii" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        </div>

        {/* 确认密码 */}
        <div className="lp-fg">
          <label className="lp-fl">确认密码</label>
          <div className="lp-iw">
            <input
              type="password"
              className="lp-fi"
              placeholder="再次输入密码"
              required
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setConfirmErr(''); }}
              style={confirmErr ? { borderColor: '#E84057' } : undefined}
            />
            <svg className="lp-ii" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          {confirmErr && <div className="lp-ferr">{confirmErr}</div>}
        </div>

        {/* 真实姓名 */}
        <div className="lp-fg">
          <label className="lp-fl">真实姓名</label>
          <div className="lp-iw">
            <input
              type="text"
              className="lp-fi"
              placeholder="请输入真实姓名"
              required
              value={realName}
              onChange={e => setRealName(e.target.value)}
            />
            <svg className="lp-ii" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M8 12h8M8 16h4" />
            </svg>
          </div>
        </div>

        {/* 手机号 */}
        <div className="lp-fg">
          <label className="lp-fl">
            手机号 <span style={{ color: '#8A94A8', fontWeight: 400, textTransform: 'none' as const, letterSpacing: 0 }}>(选填)</span>
          </label>
          <div className="lp-iw">
            <input
              type="tel"
              className="lp-fi"
              placeholder="手机号（选填）"
              value={phone}
              onChange={e => setPhone(e.target.value)}
            />
            <svg className="lp-ii" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
              <line x1="12" y1="18" x2="12.01" y2="18" />
            </svg>
          </div>
        </div>

        <button
          type="submit"
          className={`lp-btn${loading ? ' loading' : ''}`}
          disabled={loading}
          style={{ marginTop: 6 }}
        >
          {loading ? '注册中...' : '注 册'}
        </button>
      </form>

      <div className="lp-ffooter" style={{ marginTop: 16 }}>
        已有账号？ <Link to="/login">返回登录</Link>
      </div>
    </LoginBackground>
  );
}
