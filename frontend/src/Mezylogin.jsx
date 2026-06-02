import React, { useState, useEffect, useRef } from 'react';
import MezyIconDark from './MezyIcon_Dark';
import './Mezylogin.css';

export default function Mezylogin({ onLogin }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('Sorry, You Must Log In First !');
  const [ready, setReady]       = useState(false);

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

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }
    onLogin();
  };

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

        <h2 className="mezy-heading">Have an account?</h2>
        <p  className="mezy-subtext">Log in with Mezy email</p>

        {error && (
          <div className="mezy-alert" key={error}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>

          {/* Email field */}
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

          {/* Password field */}
          <div className="mezy-field" style={{ marginBottom: 20, animationDelay: '1.08s' }}>
            <label className="mezy-label">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              className="mezy-input mezy-input--password"
            />
          </div>

          {/* Links row */}
          <div className="mezy-links" style={{ animationDelay: '1.18s' }}>
            <a href="#" onClick={e => e.preventDefault()} className="mezy-link"> </a>
            <a href="#" onClick={e => e.preventDefault()} className="mezy-link">
              Lost password &rarr;
            </a>
          </div>

          {/* Login button */}
          <div className="mezy-btn-row" style={{ animationDelay: '1.28s' }}>
            <button type="submit" className="mezy-btn">
              <span style={{ position: 'relative', zIndex: 1 }}>Login</span>
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
