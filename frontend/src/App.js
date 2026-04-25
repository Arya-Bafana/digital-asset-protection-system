import React, { useState, useEffect, useRef } from 'react';

// ── MOCK DATA ──────────────────────────────────────────────────────────────
const mockAlerts = [
  { id: 1, platform: 'YouTube', uploader: '@cricket_highlights_hd', clip: 'Kohli Century - T20 World Cup', confidence: 97.3, status: 'STOLEN', color_filter: true, brightness: false },
  { id: 2, platform: 'Instagram', uploader: '@sports_reels_india', clip: 'Bumrah Hat-trick Celebration', confidence: 91.8, status: 'STOLEN', color_filter: true, brightness: true },
  { id: 3, platform: 'Telegram', uploader: 'IPL Leaks Channel', clip: 'Rohit Sharma Six Compilation', confidence: 88.5, status: 'STOLEN', color_filter: false, brightness: false },
  { id: 4, platform: 'YouTube', uploader: '@fan_edits_cricket', clip: 'Dhoni Finishes Off in Style', confidence: 76.2, status: 'INVESTIGATING', color_filter: true, brightness: true },
  { id: 5, platform: 'Reddit', uploader: 'u/cricket_fan_2024', clip: 'Shami Bowling Masterclass', confidence: 42.1, status: 'CLEAN', color_filter: false, brightness: false },
];

// ── PLATFORM ICONS ─────────────────────────────────────────────────────────
const PlatformBadge = ({ platform }) => {
  const colors = {
    YouTube: '#FF0000', Instagram: '#E1306C',
    Telegram: '#2CA5E0', Reddit: '#FF4500', Twitter: '#1DA1F2'
  };
  return (
    <span style={{
      background: colors[platform] || '#666',
      color: '#fff', fontSize: '10px', fontWeight: 700,
      padding: '2px 8px', borderRadius: '4px', letterSpacing: '0.5px'
    }}>{platform.toUpperCase()}</span>
  );
};

// ── STATUS BADGE ───────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const cfg = {
    STOLEN: { bg: 'rgba(255,59,59,0.15)', color: '#ff3b3b', border: '#ff3b3b', icon: '🚨' },
    INVESTIGATING: { bg: 'rgba(255,180,0,0.15)', color: '#ffb400', border: '#ffb400', icon: '🔍' },
    CLEAN: { bg: 'rgba(0,230,118,0.15)', color: '#00e676', border: '#00e676', icon: '✅' },
  };
  const c = cfg[status] || cfg.CLEAN;
  return (
    <span style={{
      background: c.bg, color: c.color,
      border: `1px solid ${c.border}`,
      fontSize: '11px', fontWeight: 700,
      padding: '3px 10px', borderRadius: '20px', letterSpacing: '1px'
    }}>{c.icon} {status}</span>
  );
};

// ── MAIN APP ───────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState('alerts');
  const [alerts, setAlerts] = useState(mockAlerts);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [dmcaModal, setDmcaModal] = useState(null);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState([]);
  const [uploadDone, setUploadDone] = useState(false);
  const [particles, setParticles] = useState([]);
  const [glitch, setGlitch] = useState(false);
  const fileInputRef = useRef();

  // ── Particle background ──
  useEffect(() => {
    const pts = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 1,
      speed: Math.random() * 20 + 15,
      opacity: Math.random() * 0.4 + 0.1,
    }));
    setParticles(pts);
  }, []);

  // ── Glitch effect on load ──
  useEffect(() => {
    setGlitch(true);
    setTimeout(() => setGlitch(false), 800);
  }, []);

  // ── Scan function ──
  const runScan = () => {
    if (scanning) return;
    setScanning(true);
    setScanProgress(0);
    let p = 0;
    const iv = setInterval(() => {
      p += Math.random() * 4 + 1;
      if (p >= 100) { p = 100; clearInterval(iv); setScanning(false); }
      setScanProgress(Math.min(p, 100));
    }, 80);
  };

  // ── DMCA letter ──
  const generateDMCA = (alert) => {
    const letter = `DMCA TAKEDOWN NOTICE
Sports Guardian v2.0 — Triple Hash Detection
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TO: ${alert.platform} Trust & Safety Team
RE: Unauthorized Sports Content — ${alert.clip}

INFRINGING CONTENT:
• Platform: ${alert.platform}
• Uploader: ${alert.uploader}
• Content: ${alert.clip}
• Detection Confidence: ${alert.confidence}%
• Method: Triple Hash (pHash + dHash + aHash)
• Color Filter Detected: ${alert.color_filter ? 'YES' : 'NO'}
• Brightness Change Detected: ${alert.brightness ? 'YES' : 'NO'}

I have a good faith belief this content is not authorized by
the copyright owner. Please remove immediately.

— Sports Guardian Automated DMCA System`;
    setDmcaModal({ ...alert, letter });
  };

  // ── File upload handler — supports IMAGE + VIDEO ──
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate: accept images AND videos
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      setUploadStatus([{ text: '❌ Unsupported file type. Please upload an image or video.', color: '#ff3b3b' }]);
      return;
    }

    setUploadFile(file);
    setUploadDone(false);
    setUploadStatus([]);

    const steps = isVideo ? [
      { text: '🎬 Video file detected — extracting key frames...', color: '#00e5ff', delay: 0 },
      { text: '🔍 Running pHash on frame samples...', color: '#00e5ff', delay: 900 },
      { text: '📊 Running dHash + aHash for triple fingerprint...', color: '#b388ff', delay: 1800 },
      { text: '🎨 Applying histogram normalization (color filter resistant)...', color: '#b388ff', delay: 2700 },
      { text: '🔊 Audio fingerprint queued for Phase 2...', color: '#ffb400', delay: 3400 },
      { text: `✅ "${file.name}" registered! Triple hash fingerprint saved.`, color: '#00e676', delay: 4200 },
    ] : [
      { text: '🖼️ Image file detected — processing...', color: '#00e5ff', delay: 0 },
      { text: '🔍 Generating pHash fingerprint...', color: '#00e5ff', delay: 700 },
      { text: '📊 Generating dHash + aHash...', color: '#b388ff', delay: 1400 },
      { text: '🎨 Applying histogram normalization...', color: '#b388ff', delay: 2100 },
      { text: `✅ "${file.name}" registered! Triple hash fingerprint saved.`, color: '#00e676', delay: 2900 },
    ];

    steps.forEach(({ text, color, delay }) => {
      setTimeout(() => {
        setUploadStatus(prev => [...prev, { text, color }]);
        if (text.startsWith('✅')) setUploadDone(true);
      }, delay);
    });
  };

  // ── Styles ──
  const styles = {
    app: {
      minHeight: '100vh',
      background: '#050a12',
      fontFamily: "'Courier New', monospace",
      color: '#e0e0e0',
      position: 'relative',
      overflow: 'hidden',
    },
    particle: (p) => ({
      position: 'fixed',
      left: `${p.x}%`,
      top: `${p.y}%`,
      width: `${p.size}px`,
      height: `${p.size}px`,
      borderRadius: '50%',
      background: '#00e5ff',
      opacity: p.opacity,
      animation: `float ${p.speed}s linear infinite`,
      pointerEvents: 'none',
      zIndex: 0,
    }),
    header: {
      background: 'rgba(0,229,255,0.04)',
      borderBottom: '1px solid rgba(0,229,255,0.15)',
      padding: '20px 32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'relative',
      zIndex: 10,
      backdropFilter: 'blur(10px)',
    },
    logo: {
      fontSize: '22px',
      fontWeight: 900,
      letterSpacing: '3px',
      color: '#00e5ff',
      textShadow: glitch
        ? '3px 0 #ff3b3b, -3px 0 #00e676'
        : '0 0 20px rgba(0,229,255,0.6)',
      transition: 'text-shadow 0.1s',
    },
    badge: {
      background: 'rgba(0,229,255,0.1)',
      border: '1px solid rgba(0,229,255,0.3)',
      color: '#00e5ff',
      fontSize: '10px',
      padding: '4px 12px',
      borderRadius: '20px',
      letterSpacing: '2px',
    },
    main: {
      maxWidth: '1100px',
      margin: '0 auto',
      padding: '28px 24px',
      position: 'relative',
      zIndex: 10,
    },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px',
      marginBottom: '28px',
    },
    statCard: (color) => ({
      background: `rgba(${color},0.07)`,
      border: `1px solid rgba(${color},0.25)`,
      borderRadius: '12px',
      padding: '20px',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden',
    }),
    statNum: (color) => ({
      fontSize: '32px',
      fontWeight: 900,
      color: `rgb(${color})`,
      textShadow: `0 0 20px rgba(${color},0.5)`,
      display: 'block',
    }),
    statLabel: {
      fontSize: '10px',
      color: '#888',
      letterSpacing: '2px',
      marginTop: '4px',
      display: 'block',
    },
    scanRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      marginBottom: '24px',
      background: 'rgba(0,229,255,0.04)',
      border: '1px solid rgba(0,229,255,0.12)',
      borderRadius: '12px',
      padding: '16px 20px',
    },
    scanBtn: {
      background: scanning
        ? 'rgba(0,229,255,0.1)'
        : 'linear-gradient(135deg, #00e5ff, #0090ff)',
      color: scanning ? '#00e5ff' : '#000',
      border: scanning ? '1px solid #00e5ff' : 'none',
      padding: '10px 24px',
      borderRadius: '8px',
      fontFamily: "'Courier New', monospace",
      fontSize: '12px',
      fontWeight: 700,
      letterSpacing: '2px',
      cursor: scanning ? 'not-allowed' : 'pointer',
      whiteSpace: 'nowrap',
    },
    progressBar: {
      flex: 1,
      height: '8px',
      background: 'rgba(255,255,255,0.08)',
      borderRadius: '4px',
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      width: `${scanProgress}%`,
      background: 'linear-gradient(90deg, #00e5ff, #b388ff)',
      borderRadius: '4px',
      transition: 'width 0.1s',
      boxShadow: '0 0 10px rgba(0,229,255,0.6)',
    },
    tabs: {
      display: 'flex',
      gap: '4px',
      marginBottom: '20px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '10px',
      padding: '4px',
    },
    tab: (active) => ({
      flex: 1,
      padding: '10px',
      background: active ? 'rgba(0,229,255,0.15)' : 'transparent',
      border: active ? '1px solid rgba(0,229,255,0.35)' : '1px solid transparent',
      color: active ? '#00e5ff' : '#666',
      borderRadius: '8px',
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: 700,
      letterSpacing: '2px',
      fontFamily: "'Courier New', monospace",
      transition: 'all 0.2s',
    }),
    card: {
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '12px',
      overflow: 'hidden',
    },
    alertRow: (status) => {
      const borders = { STOLEN: '#ff3b3b', INVESTIGATING: '#ffb400', CLEAN: '#00e676' };
      return {
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '16px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        borderLeft: `3px solid ${borders[status] || '#333'}`,
        transition: 'background 0.2s',
        cursor: 'default',
      };
    },
    dmcaBtn: {
      background: 'rgba(255,59,59,0.15)',
      border: '1px solid rgba(255,59,59,0.4)',
      color: '#ff3b3b',
      padding: '6px 14px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '10px',
      fontWeight: 700,
      letterSpacing: '1px',
      fontFamily: "'Courier New', monospace",
      whiteSpace: 'nowrap',
    },
    confidenceBar: (val) => ({
      width: '80px',
      height: '4px',
      background: 'rgba(255,255,255,0.1)',
      borderRadius: '2px',
      overflow: 'hidden',
      marginTop: '4px',
    }),
    confidenceFill: (val) => ({
      height: '100%',
      width: `${val}%`,
      background: val > 85 ? '#ff3b3b' : val > 70 ? '#ffb400' : '#00e676',
      borderRadius: '2px',
    }),
    uploadZone: {
      border: '2px dashed rgba(0,229,255,0.3)',
      borderRadius: '12px',
      padding: '48px',
      textAlign: 'center',
      cursor: 'pointer',
      transition: 'all 0.3s',
      background: 'rgba(0,229,255,0.02)',
    },
    uploadLog: {
      marginTop: '20px',
      background: 'rgba(0,0,0,0.4)',
      border: '1px solid rgba(0,229,255,0.1)',
      borderRadius: '8px',
      padding: '16px',
      fontFamily: "'Courier New', monospace",
      fontSize: '12px',
      minHeight: '80px',
    },
    modal: {
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, backdropFilter: 'blur(8px)',
    },
    modalBox: {
      background: '#0a1020',
      border: '1px solid rgba(0,229,255,0.3)',
      borderRadius: '16px',
      padding: '32px',
      maxWidth: '560px',
      width: '90%',
      boxShadow: '0 0 60px rgba(0,229,255,0.1)',
    },
  };

  // ── SVG Lineage Graph ──
  const LineageGraph = () => (
    <div style={{ padding: '24px' }}>
      <p style={{ color: '#888', fontSize: '12px', marginBottom: '20px', letterSpacing: '1px' }}>
        CONTENT SPREAD ANALYSIS — HOW STOLEN CLIPS PROPAGATE
      </p>
      <svg width="100%" height="320" viewBox="0 0 700 320">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* Lines */}
        {[
          [350,60,150,160],[350,60,350,160],[350,60,550,160],
          [150,160,80,260],[150,160,220,260],[350,160,350,260],[550,160,480,260],[550,160,620,260]
        ].map(([x1,y1,x2,y2],i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="rgba(0,229,255,0.25)" strokeWidth="1.5" strokeDasharray="4 3" />
        ))}
        {/* Nodes */}
        {[
          { x:350, y:60, label:'ORIGINAL', sub:'ISL Official', color:'#00e676', r:28 },
          { x:150, y:160, label:'TELEGRAM', sub:'IPL Leaks', color:'#2CA5E0', r:22 },
          { x:350, y:160, label:'YOUTUBE', sub:'@highlights', color:'#FF0000', r:22 },
          { x:550, y:160, label:'INSTAGRAM', sub:'@reels', color:'#E1306C', r:22 },
          { x:80,  y:260, label:'WA GROUP', sub:'500 views', color:'#ffb400', r:16 },
          { x:220, y:260, label:'REDDIT', sub:'r/cricket', color:'#FF4500', r:16 },
          { x:350, y:260, label:'TWITTER', sub:'@fan', color:'#1DA1F2', r:16 },
          { x:480, y:260, label:'TIKTOK', sub:'viral', color:'#ff3b3b', r:16 },
          { x:620, y:260, label:'YOUTUBE', sub:'mirror', color:'#FF0000', r:16 },
        ].map((n, i) => (
          <g key={i} filter="url(#glow)">
            <circle cx={n.x} cy={n.y} r={n.r + 6} fill={`${n.color}15`} stroke={`${n.color}40`} strokeWidth="1" />
            <circle cx={n.x} cy={n.y} r={n.r} fill={`${n.color}25`} stroke={n.color} strokeWidth="1.5" />
            <text x={n.x} y={n.y - 4} textAnchor="middle" fill={n.color} fontSize="8" fontWeight="bold" fontFamily="Courier New">{n.label}</text>
            <text x={n.x} y={n.y + 8} textAnchor="middle" fill="#888" fontSize="7" fontFamily="Courier New">{n.sub}</text>
          </g>
        ))}
      </svg>
    </div>
  );

  return (
    <div style={styles.app}>
      {/* CSS animations */}
      <style>{`
        @keyframes float {
          0% { transform: translateY(0px) translateX(0px); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(-100vh) translateX(20px); opacity: 0; }
        }
        @keyframes pulse {
          0%,100% { opacity:1; } 50% { opacity:0.5; }
        }
        @keyframes slideIn {
          from { opacity:0; transform:translateY(10px); }
          to { opacity:1; transform:translateY(0); }
        }
        .alert-row:hover { background: rgba(0,229,255,0.04) !important; }
        .scan-btn:hover { transform: scale(1.02); }
        .upload-zone:hover { border-color: rgba(0,229,255,0.6) !important; background: rgba(0,229,255,0.05) !important; }
      `}</style>

      {/* Particles */}
      {particles.map(p => <div key={p.id} style={styles.particle(p)} />)}

      {/* Header */}
      <header style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '28px' }}>🛡️</span>
          <div>
            <div style={styles.logo}>SPORTS GUARDIAN</div>
            <div style={{ fontSize: '10px', color: '#888', letterSpacing: '2px' }}>AI-POWERED PIRACY DETECTION</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span style={styles.badge}>v2.0 TRIPLE HASH</span>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00e676', animation: 'pulse 2s infinite', boxShadow: '0 0 10px #00e676' }} />
          <span style={{ fontSize: '11px', color: '#00e676', letterSpacing: '1px' }}>LIVE</span>
        </div>
      </header>

      <main style={styles.main}>

        {/* Stats */}
        <div style={styles.statsGrid}>
          {[
            { label: 'CLIPS PROTECTED', value: '2,847', color: '0,229,255', icon: '🛡️' },
            { label: 'STOLEN FOUND', value: '3', color: '255,59,59', icon: '🚨' },
            { label: 'DETECT TIME', value: '8s', color: '179,136,255', icon: '⚡' },
            { label: 'REVENUE SAVED', value: '₹4.2L', color: '0,230,118', icon: '💰' },
          ].map((s, i) => (
            <div key={i} style={styles.statCard(s.color)}>
              <span style={{ fontSize: '24px' }}>{s.icon}</span>
              <span style={styles.statNum(s.color)}>{s.value}</span>
              <span style={styles.statLabel}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Scan Row */}
        <div style={styles.scanRow}>
          <button className="scan-btn" style={styles.scanBtn} onClick={runScan}>
            {scanning ? '⟳ SCANNING...' : '▶ RUN SCAN'}
          </button>
          <div style={styles.progressBar}>
            <div style={styles.progressFill} />
          </div>
          <span style={{ fontSize: '12px', color: '#00e5ff', minWidth: '40px', textAlign: 'right' }}>
            {Math.round(scanProgress)}%
          </span>
          <span style={{ fontSize: '10px', color: '#888', letterSpacing: '1px' }}>
            {scanProgress === 100 ? '✅ COMPLETE' : scanning ? 'SCANNING PLATFORMS...' : 'READY'}
          </span>
        </div>

        {/* Tabs */}
        <div style={styles.tabs}>
          {[['alerts','🚨 ALERTS'],['lineage','🕸️ LINEAGE'],['upload','📤 REGISTER']].map(([id,label]) => (
            <button key={id} style={styles.tab(activeTab===id)} onClick={() => setActiveTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {/* ── ALERTS TAB ── */}
        {activeTab === 'alerts' && (
          <div style={styles.card}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize: '11px', color: '#888', letterSpacing: '2px' }}>DETECTION RESULTS — TRIPLE HASH ENGINE</span>
              <span style={{ fontSize: '11px', color: '#00e5ff' }}>{alerts.filter(a=>a.status==='STOLEN').length} STOLEN DETECTED</span>
            </div>
            {alerts.map((alert, i) => (
              <div key={alert.id} className="alert-row" style={{ ...styles.alertRow(alert.status), animation: `slideIn 0.3s ease ${i*0.08}s both` }}>
                <div style={{ minWidth: '80px' }}>
                  <PlatformBadge platform={alert.platform} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', color: '#e0e0e0', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {alert.clip}
                  </div>
                  <div style={{ fontSize: '11px', color: '#888' }}>{alert.uploader}</div>
                  {(alert.color_filter || alert.brightness) && (
                    <div style={{ fontSize: '10px', color: '#b388ff', marginTop: '2px' }}>
                      {alert.color_filter && '🎨 filter detected '}{alert.brightness && '☀️ brightness changed'}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'center', minWidth: '70px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: alert.confidence > 85 ? '#ff3b3b' : alert.confidence > 70 ? '#ffb400' : '#00e676' }}>
                    {alert.confidence}%
                  </span>
                  <div style={styles.confidenceBar(alert.confidence)}>
                    <div style={styles.confidenceFill(alert.confidence)} />
                  </div>
                </div>
                <StatusBadge status={alert.status} />
                {alert.status !== 'CLEAN' && (
                  <button style={styles.dmcaBtn} onClick={() => generateDMCA(alert)}>
                    DMCA
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── LINEAGE TAB ── */}
        {activeTab === 'lineage' && (
          <div style={styles.card}>
            <LineageGraph />
          </div>
        )}

        {/* ── UPLOAD TAB ── */}
        {activeTab === 'upload' && (
          <div style={styles.card}>
            <div style={{ padding: '24px' }}>
              <p style={{ color: '#888', fontSize: '11px', letterSpacing: '2px', marginBottom: '20px' }}>
                REGISTER CONTENT — SUPPORTS IMAGES & VIDEOS
              </p>

              {/* Upload zone */}
              <div
                className="upload-zone"
                style={styles.uploadZone}
                onClick={() => fileInputRef.current.click()}
              >
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>
                  {uploadFile ? (uploadFile.type.startsWith('video/') ? '🎬' : '🖼️') : '📁'}
                </div>
                <div style={{ color: '#00e5ff', fontSize: '13px', fontWeight: 700, letterSpacing: '2px', marginBottom: '8px' }}>
                  {uploadFile ? uploadFile.name : 'CLICK TO UPLOAD'}
                </div>
                <div style={{ color: '#888', fontSize: '11px' }}>
                  Supports: MP4, MOV, AVI, MKV, JPG, PNG, WEBP
                </div>
                {uploadFile && (
                  <div style={{ marginTop: '8px', fontSize: '11px', color: '#b388ff' }}>
                    {(uploadFile.size / 1024 / 1024).toFixed(2)} MB — {uploadFile.type}
                  </div>
                )}
              </div>

              {/* Hidden file input — accepts images AND videos */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,.mp4,.mov,.avi,.mkv,.webm"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />

              {/* Upload log */}
              {uploadStatus.length > 0 && (
                <div style={styles.uploadLog}>
                  {uploadStatus.map((s, i) => (
                    <div key={i} style={{ color: s.color, marginBottom: '6px', animation: 'slideIn 0.3s ease' }}>
                      {s.text}
                    </div>
                  ))}
                </div>
              )}

              {uploadDone && (
                <div style={{ marginTop: '16px', padding: '16px', background: 'rgba(0,230,118,0.08)', border: '1px solid rgba(0,230,118,0.3)', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ color: '#00e676', fontSize: '13px', fontWeight: 700, letterSpacing: '2px' }}>
                    ✅ FINGERPRINT REGISTERED
                  </div>
                  <div style={{ color: '#888', fontSize: '11px', marginTop: '4px' }}>
                    Triple hash (pHash + dHash + aHash) saved. Color filter resistant: YES
                  </div>
                </div>
              )}

              {/* Tech info */}
              <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {[
                  { icon: '🔒', title: 'pHash', desc: 'Perceptual fingerprint' },
                  { icon: '📊', title: 'dHash', desc: 'Edge detection hash' },
                  { icon: '☀️', title: 'aHash', desc: 'Brightness hash' },
                  { icon: '🎨', title: 'Histogram', desc: 'Filter normalization' },
                ].map((t, i) => (
                  <div key={i} style={{ background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.1)', borderRadius: '8px', padding: '12px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={{ fontSize: '20px' }}>{t.icon}</span>
                    <div>
                      <div style={{ color: '#00e5ff', fontSize: '11px', fontWeight: 700 }}>{t.title}</div>
                      <div style={{ color: '#888', fontSize: '10px' }}>{t.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── DMCA MODAL ── */}
      {dmcaModal && (
        <div style={styles.modal} onClick={() => setDmcaModal(null)}>
          <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <div style={{ color: '#00e5ff', fontWeight: 700, fontSize: '14px', letterSpacing: '2px' }}>DMCA TAKEDOWN</div>
                <div style={{ color: '#888', fontSize: '11px' }}>{dmcaModal.platform} — {dmcaModal.confidence}% confidence</div>
              </div>
              <button onClick={() => setDmcaModal(null)} style={{ background: 'none', border: '1px solid #333', color: '#888', width: '32px', height: '32px', borderRadius: '6px', cursor: 'pointer', fontSize: '16px' }}>×</button>
            </div>
            <textarea
              readOnly
              value={dmcaModal.letter}
              style={{ width: '100%', height: '280px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(0,229,255,0.15)', color: '#ccc', padding: '16px', borderRadius: '8px', fontFamily: "'Courier New', monospace", fontSize: '11px', resize: 'none', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button
                onClick={() => { navigator.clipboard.writeText(dmcaModal.letter); }}
                style={{ flex: 1, background: 'linear-gradient(135deg,#00e5ff,#0090ff)', color: '#000', border: 'none', padding: '12px', borderRadius: '8px', fontWeight: 700, fontSize: '12px', letterSpacing: '2px', cursor: 'pointer', fontFamily: "'Courier New', monospace" }}
              >📋 COPY LETTER</button>
              <button onClick={() => setDmcaModal(null)} style={{ padding: '12px 20px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#888', borderRadius: '8px', cursor: 'pointer', fontFamily: "'Courier New', monospace" }}>
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
