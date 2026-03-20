import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { message } from 'antd';
import { useAuth } from '../store/auth';
import LoginBackground from './LoginBackground';

export default function LoginNew() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username.trim(), password, remember);
      message.success('登录成功');
      navigate('/patients', { replace: true });
    } catch {
      // Error is already handled by the request interceptor (message.error)
    } finally {
      setLoading(false);
    }
  };

  return (
    <LoginBackground>
      <div className="lp-fheader">
        <h2>欢迎回来</h2>
        <p>请登录您的账户以继续</p>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="lp-fg">
          <label className="lp-fl">用户名</label>
          <div className="lp-iw">
            <input
              type="text"
              className="lp-fi"
              placeholder="请输入用户名"
              autoComplete="off"
              required
              maxLength={50}
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
            <svg className="lp-ii" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
        </div>

        <div className="lp-fg">
          <label className="lp-fl">密码</label>
          <div className="lp-iw">
            <input
              type={showPassword ? 'text' : 'password'}
              className="lp-fi"
              style={{ paddingRight: 46 }}
              placeholder="请输入密码"
              required
              maxLength={50}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            <svg className="lp-ii" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <button
              type="button"
              className="lp-ptoggle"
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              onClick={() => setShowPassword(v => !v)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {showPassword ? (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        <div className="lp-fopts">
          <label className="lp-chk">
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
            />
            <span className="lp-chkbox">
              <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 6 5 9 10 3" />
              </svg>
            </span>
            记住我
          </label>
        </div>

        <button
          type="submit"
          className={`lp-btn${loading ? ' loading' : ''}`}
          disabled={loading}
        >
          {loading ? '登录中...' : '登 录'}
        </button>
      </form>

      <div className="lp-ffooter">
        还没有账号？ <Link to="/register">立即注册</Link>
      </div>
    </LoginBackground>
  );
}
