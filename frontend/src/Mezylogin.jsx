import React, { useState, useEffect, useRef } from 'react';
import MezyIconDark from './MezyIcon_Dark';
import { authLogin, authSignup, authForgotPassword, authResetPassword } from './api';
import './Mezylogin.css';

export default function Mezylogin({ onLogin }) {
  const [mode, setMode]             = useState('login'); // 'login' | 'signup' | 'forgot' | 'reset'
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [companyName, setCompany]   = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPass]   = useState('');
  const [confirmPass, setConfirm]   = useState('');
  const [error, setError]           = useState('Sorry, You Must Log In First !');
  const [info, setInfo]             = useState('');
  const [busy, setBusy]             = useState(false);
  const [ready, setReady]           = useState(false);

  const pageRef = useRef(null);
  const cardRef = useRef(null);

  // Enable cursor-aware tilt after card entrance settles
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1600);
    return () => clearTimeout(t);
  }, []);

  // Cursor-aware 3D tilt — Housekeeper-style signature interaction
  useEffect(() => {
    if (!ready) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const page = pageRef.current;
    const card = cardRef.current;
    if (!page || !card) return;

    let rafId = null;
    let targetRX = 0, targetRY = 0, targetY = 0;
    let curRX = 0,    curRY = 0,    curY = 0;

    const onMove = (e) => {
      const rect = page.getBoundingClientRect();
      const cx = rect.width  / 2;
      const cy = rect.height / 2;
      const dx = (e.clientX - rect.left - cx) / cx; // -1..1
      const dy = (e.clientY - rect.top  - cy) / cy; // -1..1

      targetRY =  dx * 4;   // max ±4deg
      targetRX = -dy * 4;
      targetY  = -Math.abs(dy) * 2; // gentle lift toward cursor
    };

    const onLeave = () => {
      targetRX = 0; targetRY = 0; targetY = 0;
    };

    const tick = () => {
      curRX += (targetRX - curRX) * 0.08;
      curRY += (targetRY - curRY) * 0.08;
      curY  += (targetY  - curY)  * 0.08;
      card.style.setProperty('--mezy-rx',       `${curRX.toFixed(2)}deg`);
      card.style.setProperty('--mezy-ry',       `${curRY.toFixed(2)}deg`);
      card.style.setProperty('--mezy-float-y',  `${curY.toFixed(2)}px`);
      rafId = requestAnimationFrame(tick);
    };

    page.addEventListener('mousemove', onMove);
    page.addEventListener('mouseleave', onLeave);
    rafId = requestAnimationFrame(tick);

    return () => {
      page.removeEventListener('mousemove', onMove);
      page.removeEventListener('mouseleave', onLeave);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [ready]);

  const switchMode = (newMode) => {
    setMode(newMode);
    setError('');
    setInfo('');
    setEmail('');
    setPassword('');
    setCompany('');
    setResetToken('');
    setNewPass('');
    setConfirm('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');

    // ── Forgot password mode ───────────────────────────────────────────────
    if (mode === 'forgot') {
      if (!email.trim()) { setError('Please enter your email address.'); return; }
      setBusy(true);
      try {
        const data = await authForgotPassword(email.trim());
        // Token returned directly (no email infra) — pre-fill reset form
        setResetToken(data.token || '');
        setMode('reset');
        setEmail('');
        setInfo('Reset code generated. Enter it below with your new password.');
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
      return;
    }

    // ── Reset password mode ────────────────────────────────────────────────
    if (mode === 'reset') {
      if (!resetToken.trim()) { setError('Please enter the reset code.'); return; }
      if (!newPassword)        { setError('Please enter a new password.'); return; }
      if (newPassword.length < 6) { setError('Password must be at least 6 characters.'); return; }
      if (newPassword !== confirmPass) { setError('Passwords do not match.'); return; }
      setBusy(true);
      try {
        await authResetPassword(resetToken.trim(), newPassword);
        switchMode('login');
        setInfo('Password updated successfully. You can now log in.');
        setError('');
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }


    setBusy(true);
    try {
      if (mode === 'login') {
        const data = await authLogin(email.trim(), password);
        onLogin(data.token, { email: data.email, companyName: data.companyName, role: data.role });
      } else {
        await authSignup(email.trim(), password, companyName.trim());
        setInfo('Signup successful! Your account is pending admin approval.');
        switchMode('login');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const isLogin  = mode === 'login';
  const isForgot = mode === 'forgot';
  const isReset  = mode === 'reset';

  const heading  = isLogin  ? 'Have an account?'
                 : isForgot ? 'Reset password'
                 : isReset  ? 'Set new password'
                 :            'Request access';
  const subtext  = isLogin  ? 'Log in with Mezy email'
                 : isForgot ? 'Enter your registered email'
                 : isReset  ? 'Enter your reset code and new password'
                 :            'Create your dashboard account';
  const btnLabel = isLogin  ? 'Login'
                 : isForgot ? 'Get reset code'
                 : isReset  ? 'Set new password'
                 :            'Request Access';

  return (
    <div className="mezy-page" ref={pageRef}>

      {/* Ambient depth orbs — drift slowly behind everything */}
      <div className="mezy-orb mezy-orb--warm"   aria-hidden="true" />
      <div className="mezy-orb mezy-orb--cool"   aria-hidden="true" />
      <div className="mezy-orb mezy-orb--accent" aria-hidden="true" />

      {/* Logo — first to appear */}
      <div className="mezy-logo">
        <MezyIconDark
          height={60}
          style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}
        />
      </div>

      {/* Card — rises in with depth, then tilts with cursor */}
      <div
        ref={cardRef}
        className={`mezy-card ${ready ? 'is-ready' : ''}`}
      >

        <h2 className="mezy-heading">{heading}</h2>
        <p  className="mezy-subtext">{subtext}</p>

        {error && (
          <div className="mezy-alert" key={error}>
            {error}
          </div>
        )}

        {info && (
          <div className="mezy-alert" style={{ background: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.35)', color: '#16a34a' }} key={info}>
            {info}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>

          {/* Email field — login, signup, forgot */}
          {!isReset && (
          <div className="mezy-field" style={{ marginBottom: 14, animationDelay: '0.98s' }}>
            <label className="mezy-label">Email</label>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              className="mezy-input mezy-input--email"
            />
          </div>
          )}

          {/* Password field — login and signup only */}
          {(isLogin || mode === 'signup') && (
          <div className="mezy-field" style={{ marginBottom: mode === 'signup' ? 14 : 20, animationDelay: '1.08s' }}>
            <label className="mezy-label">Password</label>
            <input
              type="password"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              className="mezy-input mezy-input--password"
            />
          </div>
          )}



          {/* Reset code + new password fields — reset mode only */}
          {isReset && (
            <>
              <div className="mezy-field" style={{ marginBottom: 14, animationDelay: '0.98s' }}>
                <label className="mezy-label">Reset code</label>
                <input
                  type="text"
                  autoComplete="off"
                  value={resetToken}
                  onChange={e => { setResetToken(e.target.value); setError(''); }}
                  className="mezy-input"
                  placeholder="Paste your reset code"
                />
              </div>
              <div className="mezy-field" style={{ marginBottom: 14, animationDelay: '1.08s' }}>
                <label className="mezy-label">New password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={e => { setNewPass(e.target.value); setError(''); }}
                  className="mezy-input mezy-input--password"
                />
              </div>
              <div className="mezy-field" style={{ marginBottom: 20, animationDelay: '1.12s' }}>
                <label className="mezy-label">Confirm new password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPass}
                  onChange={e => { setConfirm(e.target.value); setError(''); }}
                  className="mezy-input mezy-input--password"
                />
              </div>
            </>
          )}

          {/* Links row */}
          {isLogin && (
            <div className="mezy-links" style={{ animationDelay: '1.18s' }}>
              <a href="#" onClick={e => { e.preventDefault(); switchMode('signup'); }} className="mezy-link">
                Request access &rarr;
              </a>
              <a href="#" onClick={e => { e.preventDefault(); switchMode('forgot'); }} className="mezy-link">
                Lost password &rarr;
              </a>
            </div>
          )}
          {!isLogin && (
            <div className="mezy-links" style={{ animationDelay: '1.18s' }}>
              <a href="#" onClick={e => { e.preventDefault(); switchMode('login'); }} className="mezy-link">
                &larr; Back to login
              </a>
            </div>
          )}

          {/* Submit button */}
          <div className="mezy-btn-row" style={{ animationDelay: '1.28s' }}>
            <button type="submit" className="mezy-btn" disabled={busy}>
              <span style={{ position: 'relative', zIndex: 1 }}>{busy ? '…' : btnLabel}</span>
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

