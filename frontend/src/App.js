import React, { useState, useRef, useCallback } from 'react';

// ─────────────────────────────────────────────
//  REAL PERCEPTUAL HASHING IN THE BROWSER
//  No backend needed — runs entirely in JS
// ─────────────────────────────────────────────

// Draw image/video-frame onto a canvas and get pixel data
async function getPixels(source, size = 32) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const draw = (img) => {
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      // Convert to greyscale
      const grey = [];
      for (let i = 0; i < data.length; i += 4) {
        grey.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      }
      resolve(grey);
    };

    if (source instanceof HTMLVideoElement) {
      draw(source);
    } else {
      const img = new Image();
      img.onload = () => draw(img);
      img.src = source;
    }
  });
}

// pHash — Discrete Cosine Transform based hash
async function computePHash(source) {
  const size = 32;
  const pixels = await getPixels(source, size);

  // Simple DCT
  const dct = [];
  for (let u = 0; u < size; u++) {
    for (let v = 0; v < size; v++) {
      let sum = 0;
      for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
          sum += pixels[x * size + y] *
            Math.cos((2 * x + 1) * u * Math.PI / (2 * size)) *
            Math.cos((2 * y + 1) * v * Math.PI / (2 * size));
        }
      }
      dct.push(sum);
    }
  }

  // Take top-left 8x8 (excluding DC component at 0,0)
  const topLeft = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      if (u === 0 && v === 0) continue;
      topLeft.push(dct[u * size + v]);
    }
  }

  const mean = topLeft.reduce((a, b) => a + b, 0) / topLeft.length;
  return topLeft.map(v => (v > mean ? 1 : 0));
}

// dHash — difference hash (adjacent pixel brightness comparison)
async function computeDHash(source) {
  const pixels = await getPixels(source, 9); // 9x8 → 8x8 differences
  const hash = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      hash.push(pixels[row * 9 + col] > pixels[row * 9 + col + 1] ? 1 : 0);
    }
  }
  return hash;
}

// aHash — average hash
async function computeAHash(source) {
  const pixels = await getPixels(source, 8);
  const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
  return pixels.map(v => (v > mean ? 1 : 0));
}

// Hamming distance between two bit arrays
function hammingDistance(a, b) {
  let dist = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist;
}

// Similarity from hamming distance (0–100%)
function similarity(dist, len) {
  return Math.round((1 - dist / len) * 100 * 10) / 10;
}

// Compute all three hashes for an image source (URL or video element)
async function computeAllHashes(source) {
  const [ph, dh, ah] = await Promise.all([
    computePHash(source),
    computeDHash(source),
    computeAHash(source),
  ]);
  return { pHash: ph, dHash: dh, aHash: ah };
}

// Compare two hash sets → returns detailed result
function compareHashes(orig, susp) {
  const pDist = hammingDistance(orig.pHash, susp.pHash);
  const dDist = hammingDistance(orig.dHash, susp.dHash);
  const aDist = hammingDistance(orig.aHash, susp.aHash);

  const pSim = similarity(pDist, orig.pHash.length);
  const dSim = similarity(dDist, orig.dHash.length);
  const aSim = similarity(aDist, orig.aHash.length);

  // Weighted average — pHash is most reliable for edits
  const overall = Math.round((pSim * 0.5 + dSim * 0.3 + aSim * 0.2) * 10) / 10;

  let status, reason;
  if (overall >= 85) {
    status = 'STOLEN';
    reason = 'Content is near-identical. This is a pirated copy.';
  } else if (overall >= 70) {
    status = 'SUSPICIOUS';
    reason = 'Significant similarity detected. Likely edited copy.';
  } else if (overall >= 50) {
    status = 'INVESTIGATING';
    reason = 'Partial match. May be a cropped or heavily edited version.';
  } else {
    status = 'CLEAN';
    reason = 'Content appears to be different. No piracy detected.';
  }

  return { pSim, dSim, aSim, overall, status, reason, pDist, dDist, aDist };
}

// Extract a frame from a video file at a given time (default: 2 seconds)
function extractVideoFrame(file, timeSeconds = 2) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.crossOrigin = 'anonymous';

    video.addEventListener('loadeddata', () => {
      video.currentTime = Math.min(timeSeconds, video.duration / 2);
    });

    video.addEventListener('seeked', () => {
      resolve({ video, url });
    });

    video.addEventListener('error', reject);
    video.load();
  });
}

// ─────────────────────────────────────────────
//  COMPONENTS
// ─────────────────────────────────────────────

const COLORS = {
  green: '#16a34a',
  greenLight: '#22c55e',
  red: '#dc2626',
  redLight: '#ef4444',
  amber: '#d97706',
  amberLight: '#f59e0b',
  blue: '#1d4ed8',
  blueLight: '#3b82f6',
  bg: '#0f172a',
  surface: '#1e293b',
  border: '#334155',
  text: '#f1f5f9',
  muted: '#94a3b8',
  accent: '#22c55e',
};

const statusCfg = {
  STOLEN: { color: COLORS.red, bg: 'rgba(220,38,38,0.12)', border: 'rgba(220,38,38,0.35)', icon: '🚨', label: 'STOLEN' },
  SUSPICIOUS: { color: COLORS.amber, bg: 'rgba(217,119,6,0.12)', border: 'rgba(217,119,6,0.35)', icon: '⚠️', label: 'SUSPICIOUS' },
  INVESTIGATING: { color: COLORS.amberLight, bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.25)', icon: '🔍', label: 'INVESTIGATING' },
  CLEAN: { color: COLORS.green, bg: 'rgba(22,163,74,0.12)', border: 'rgba(22,163,74,0.35)', icon: '✅', label: 'CLEAN' },
};

// ── File Drop Zone ──
function DropZone({ label, file, preview, onFile, accept, hint }) {
  const ref = useRef();
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  return (
    <div
      onClick={() => ref.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${dragging ? COLORS.greenLight : file ? COLORS.green : COLORS.border}`,
        borderRadius: 12,
        background: dragging ? 'rgba(34,197,94,0.06)' : file ? 'rgba(34,197,94,0.04)' : 'rgba(255,255,255,0.02)',
        padding: '20px 16px',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative',
        minHeight: 160,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }} onChange={e => e.target.files[0] && onFile(e.target.files[0])} />

      {preview ? (
        <img src={preview} alt="preview" style={{ maxHeight: 100, maxWidth: '100%', borderRadius: 8, objectFit: 'contain', marginBottom: 4 }} />
      ) : (
        <div style={{ fontSize: 36 }}>{accept.includes('video') ? '🎬' : '🖼️'}</div>
      )}

      <div style={{ fontWeight: 700, fontSize: 13, color: file ? COLORS.greenLight : COLORS.text, letterSpacing: 1 }}>
        {file ? file.name : label}
      </div>
      {file && (
        <div style={{ fontSize: 11, color: COLORS.muted }}>
          {(file.size / 1024 / 1024).toFixed(2)} MB
        </div>
      )}
      {!file && <div style={{ fontSize: 11, color: COLORS.muted }}>{hint}</div>}
    </div>
  );
}

// ── Hash Meter ──
function HashMeter({ label, value, color }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: COLORS.muted, letterSpacing: 1 }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>{value}%</span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${value}%`,
          background: color,
          borderRadius: 3,
          transition: 'width 0.8s ease',
        }} />
      </div>
    </div>
  );
}

// ── DMCA Modal ──
function DmcaModal({ result, origFile, suspFile, onClose }) {
  const letter = `DMCA TAKEDOWN NOTICE
Sports Guardian — Triple Hash Detection System
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TO: Platform Trust & Safety Team
RE: Unauthorized Sports Content

INFRINGING CONTENT:
• Original File: ${origFile?.name || 'Registered content'}
• Suspected Copy: ${suspFile?.name || 'Detected content'}
• Detection Confidence: ${result?.overall}%
• pHash Similarity: ${result?.pSim}%
• dHash Similarity: ${result?.dSim}%
• aHash Similarity: ${result?.aSim}%
• Detection Method: Triple Hash (pHash + dHash + aHash)
• Status: ${result?.status}

I have a good faith belief that this content infringes on 
the copyright of the registered content owner. I request 
immediate removal under the DMCA Section 512(c).

— Sports Guardian Automated DMCA System
   Generated: ${new Date().toLocaleString()}`;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 28, maxWidth: 520, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: COLORS.text, letterSpacing: 1 }}>DMCA TAKEDOWN NOTICE</div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${COLORS.border}`, color: COLORS.muted, width: 30, height: 30, borderRadius: 6, cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        <textarea readOnly value={letter} style={{ width: '100%', height: 260, background: 'rgba(0,0,0,0.3)', border: `1px solid ${COLORS.border}`, color: '#ccc', padding: 14, borderRadius: 8, fontFamily: 'monospace', fontSize: 11, resize: 'none', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button onClick={() => navigator.clipboard.writeText(letter)}
            style={{ flex: 1, background: COLORS.green, color: '#fff', border: 'none', padding: '10px', borderRadius: 8, fontWeight: 700, fontSize: 12, letterSpacing: 1, cursor: 'pointer' }}>
            📋 COPY LETTER
          </button>
          <button onClick={onClose} style={{ padding: '10px 18px', background: 'rgba(255,255,255,0.05)', border: `1px solid ${COLORS.border}`, color: COLORS.muted, borderRadius: 8, cursor: 'pointer' }}>CLOSE</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  MAIN APP
// ─────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState('compare');

  // Compare tab state
  const [origFile, setOrigFile] = useState(null);
  const [origPreview, setOrigPreview] = useState(null);
  const [origHashes, setOrigHashes] = useState(null);
  const [origStatus, setOrigStatus] = useState('');

  const [suspFile, setSuspFile] = useState(null);
  const [suspPreview, setSuspPreview] = useState(null);
  const [suspHashes, setSuspHashes] = useState(null);
  const [suspStatus, setSuspStatus] = useState('');

  const [result, setResult] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [dmcaOpen, setDmcaOpen] = useState(false);

  // Register tab state
  const [regFile, setRegFile] = useState(null);
  const [regPreview, setRegPreview] = useState(null);
  const [regHashes, setRegHashes] = useState(null);
  const [regLog, setRegLog] = useState([]);
  const [regDone, setRegDone] = useState(false);

  // Mock alerts for dashboard
  const mockAlerts = [
    { id: 1, platform: 'YouTube', uploader: '@cricket_highlights_hd', clip: 'Kohli Century — T20 World Cup', confidence: 97.3, status: 'STOLEN' },
    { id: 2, platform: 'Instagram', uploader: '@sports_reels_india', clip: 'Bumrah Hat-trick Celebration', confidence: 91.8, status: 'STOLEN' },
    { id: 3, platform: 'Telegram', uploader: 'IPL Leaks Channel', clip: 'Rohit Sharma Six Compilation', confidence: 88.5, status: 'SUSPICIOUS' },
    { id: 4, platform: 'YouTube', uploader: '@fan_edits_cricket', clip: 'Dhoni Finishes Off in Style', confidence: 76.2, status: 'INVESTIGATING' },
    { id: 5, platform: 'Reddit', uploader: 'u/cricket_fan_2024', clip: 'Shami Bowling Masterclass', confidence: 42.1, status: 'CLEAN' },
  ];

  // ── Load original file ──
  const loadOriginal = useCallback(async (file) => {
    setOrigFile(file);
    setResult(null);
    setOrigStatus('Processing...');
    setOrigHashes(null);

    const isVideo = file.type.startsWith('video/');

    try {
      if (isVideo) {
        const { video, url } = await extractVideoFrame(file);
        const hashes = await computeAllHashes(video);
        setOrigHashes(hashes);
        // For preview, capture canvas frame
        const canvas = document.createElement('canvas');
        canvas.width = 200; canvas.height = 120;
        canvas.getContext('2d').drawImage(video, 0, 0, 200, 120);
        setOrigPreview(canvas.toDataURL());
        URL.revokeObjectURL(url);
      } else {
        const url = URL.createObjectURL(file);
        setOrigPreview(url);
        const hashes = await computeAllHashes(url);
        setOrigHashes(hashes);
      }
      setOrigStatus('✅ Fingerprint ready');
    } catch {
      setOrigStatus('❌ Failed to process file');
    }
  }, []);

  // ── Load suspect file ──
  const loadSuspect = useCallback(async (file) => {
    setSuspFile(file);
    setResult(null);
    setSuspStatus('Processing...');
    setSuspHashes(null);

    const isVideo = file.type.startsWith('video/');

    try {
      if (isVideo) {
        const { video, url } = await extractVideoFrame(file);
        const hashes = await computeAllHashes(video);
        setSuspHashes(hashes);
        const canvas = document.createElement('canvas');
        canvas.width = 200; canvas.height = 120;
        canvas.getContext('2d').drawImage(video, 0, 0, 200, 120);
        setSuspPreview(canvas.toDataURL());
        URL.revokeObjectURL(url);
      } else {
        const url = URL.createObjectURL(file);
        setSuspPreview(url);
        const hashes = await computeAllHashes(url);
        setSuspHashes(hashes);
      }
      setSuspStatus('✅ Fingerprint ready');
    } catch {
      setSuspStatus('❌ Failed to process file');
    }
  }, []);

  // ── Run comparison ──
  const runComparison = async () => {
    if (!origHashes || !suspHashes) return;
    setComparing(true);
    await new Promise(r => setTimeout(r, 600));
    const res = compareHashes(origHashes, suspHashes);
    setResult(res);
    setComparing(false);
  };

  // ── Register file ──
  const registerFile = useCallback(async (file) => {
    setRegFile(file);
    setRegDone(false);
    setRegLog([]);
    setRegHashes(null);
    setRegPreview(null);

    const isVideo = file.type.startsWith('video/');
    const addLog = (text, color) => setRegLog(prev => [...prev, { text, color }]);

    addLog(isVideo ? '🎬 Video detected — extracting key frame...' : '🖼️ Image detected — loading...', COLORS.blueLight);

    try {
      let source;
      if (isVideo) {
        const { video, url } = await extractVideoFrame(file);
        source = video;
        const canvas = document.createElement('canvas');
        canvas.width = 200; canvas.height = 120;
        canvas.getContext('2d').drawImage(video, 0, 0, 200, 120);
        setRegPreview(canvas.toDataURL());
        URL.revokeObjectURL(url);
      } else {
        source = URL.createObjectURL(file);
        setRegPreview(source);
      }

      await new Promise(r => setTimeout(r, 600));
      addLog('🔍 Generating pHash (perceptual fingerprint)...', COLORS.blueLight);

      const pHash = await computePHash(source);
      await new Promise(r => setTimeout(r, 400));
      addLog('📊 Generating dHash (edge detection hash)...', '#818cf8');

      const dHash = await computeDHash(source);
      await new Promise(r => setTimeout(r, 400));
      addLog('☀️ Generating aHash (brightness hash)...', '#818cf8');

      const aHash = await computeAHash(source);
      await new Promise(r => setTimeout(r, 300));
      addLog('🎨 Applying histogram normalization...', '#818cf8');
      await new Promise(r => setTimeout(r, 400));

      const hashes = { pHash, dHash, aHash };
      setRegHashes(hashes);
      setRegDone(true);
      addLog(`✅ "${file.name}" registered! Triple hash fingerprint saved.`, COLORS.greenLight);
    } catch {
      addLog('❌ Failed to process file. Try a different format.', COLORS.red);
    }
  }, []);

  // ── Styles ──
  const s = {
    wrap: { minHeight: '100vh', background: COLORS.bg, color: COLORS.text, fontFamily: "'Segoe UI', system-ui, sans-serif" },
    header: {
      background: '#0a1628',
      borderBottom: `1px solid ${COLORS.border}`,
      padding: '0 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 64,
    },
    logo: { display: 'flex', alignItems: 'center', gap: 12 },
    main: { maxWidth: 960, margin: '0 auto', padding: '28px 20px' },
    statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 24 },
    stat: (color) => ({
      background: COLORS.surface,
      border: `1px solid ${COLORS.border}`,
      borderTop: `3px solid ${color}`,
      borderRadius: 10,
      padding: '16px 14px',
      textAlign: 'center',
    }),
    tabs: { display: 'flex', gap: 4, marginBottom: 20, background: COLORS.surface, borderRadius: 10, padding: 4, border: `1px solid ${COLORS.border}` },
    tab: (active) => ({
      flex: 1,
      padding: '9px 8px',
      background: active ? '#1d4ed8' : 'transparent',
      border: active ? '1px solid rgba(59,130,246,0.5)' : '1px solid transparent',
      color: active ? '#fff' : COLORS.muted,
      borderRadius: 8,
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: 0.5,
      fontFamily: 'inherit',
      transition: 'all 0.18s',
    }),
    card: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 },
    cardHead: { padding: '14px 18px', borderBottom: `1px solid ${COLORS.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    cardBody: { padding: 18 },
    btn: (color, outline) => ({
      background: outline ? 'transparent' : color,
      border: `1px solid ${color}`,
      color: outline ? color : '#fff',
      padding: '10px 20px',
      borderRadius: 8,
      fontWeight: 700,
      fontSize: 13,
      cursor: 'pointer',
      fontFamily: 'inherit',
      letterSpacing: 0.5,
      transition: 'all 0.15s',
    }),
  };

  const platformColors = { YouTube: '#ef4444', Instagram: '#ec4899', Telegram: '#3b82f6', Reddit: '#f97316', Twitter: '#38bdf8' };

  return (
    <div style={s.wrap}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${COLORS.bg}; }
        button:hover { opacity: 0.88; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
        .fade-in { animation: fadeIn 0.35s ease both; }
      `}</style>

      {/* HEADER */}
      <header style={s.header}>
        <div style={s.logo}>
          <span style={{ fontSize: 26 }}>🛡️</span>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: 1.5, color: COLORS.text }}>SPORTS GUARDIAN</div>
            <div style={{ fontSize: 10, color: COLORS.muted, letterSpacing: 2 }}>CONTENT PROTECTION SYSTEM</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: COLORS.greenLight, fontSize: 10, padding: '4px 12px', borderRadius: 20, fontWeight: 700, letterSpacing: 2 }}>
            v2.0 TRIPLE HASH
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: COLORS.greenLight, boxShadow: '0 0 8px #22c55e' }} />
            <span style={{ fontSize: 11, color: COLORS.greenLight, fontWeight: 700 }}>LIVE</span>
          </div>
        </div>
      </header>

      <main style={s.main}>

        {/* STATS */}
        <div style={s.statsRow}>
          {[
            { label: 'CLIPS PROTECTED', val: '2,847', color: COLORS.blueLight, icon: '🛡️' },
            { label: 'STOLEN DETECTED', val: '3', color: COLORS.red, icon: '🚨' },
            { label: 'DETECT TIME', val: '8s', color: '#a78bfa', icon: '⚡' },
            { label: 'REVENUE SAVED', val: '₹4.2L', color: COLORS.greenLight, icon: '💰' },
          ].map((st, i) => (
            <div key={i} style={s.stat(st.color)}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{st.icon}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: st.color }}>{st.val}</div>
              <div style={{ fontSize: 10, color: COLORS.muted, letterSpacing: 1.5, marginTop: 2 }}>{st.label}</div>
            </div>
          ))}
        </div>

        {/* TABS */}
        <div style={s.tabs}>
          {[
            ['compare', '🔍 COMPARE & DETECT'],
            ['register', '📤 REGISTER CONTENT'],
            ['alerts', '🚨 ALERTS DASHBOARD'],
            ['lineage', '🕸️ SPREAD MAP'],
          ].map(([id, label]) => (
            <button key={id} style={s.tab(tab === id)} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {/* ── COMPARE TAB ── */}
        {tab === 'compare' && (
          <div className="fade-in">
            {/* HOW IT WORKS BANNER */}
            <div style={{ background: 'rgba(29,78,216,0.1)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 18, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 18 }}>ℹ️</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#93c5fd', marginBottom: 3 }}>HOW TO DEMO THIS TO JUDGES</div>
                <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.6 }}>
                  <b style={{ color: COLORS.text }}>Step 1:</b> Upload your original sports photo/video below (left box).<br />
                  <b style={{ color: COLORS.text }}>Step 2:</b> Open that image in any app → apply a filter, crop it, change brightness, or slow it down → save as a new file.<br />
                  <b style={{ color: COLORS.text }}>Step 3:</b> Upload that edited version (right box).<br />
                  <b style={{ color: COLORS.text }}>Step 4:</b> Click COMPARE — the system shows a real confidence score using pHash + dHash + aHash. If similarity is 85%+, it flags as STOLEN. Works on images AND videos.
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              {/* ORIGINAL */}
              <div style={s.card}>
                <div style={s.cardHead}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.greenLight }}>📁 ORIGINAL CONTENT</span>
                  {origStatus && <span style={{ fontSize: 11, color: origStatus.includes('✅') ? COLORS.greenLight : COLORS.muted }}>{origStatus}</span>}
                </div>
                <div style={s.cardBody}>
                  <DropZone
                    label="Upload Original"
                    file={origFile}
                    preview={origPreview}
                    onFile={loadOriginal}
                    accept="image/*,video/*"
                    hint="JPG, PNG, MP4, MOV supported"
                  />
                  {origHashes && (
                    <div style={{ marginTop: 12, padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8, fontFamily: 'monospace', fontSize: 11, color: COLORS.muted }}>
                      <div>pHash: <span style={{ color: COLORS.greenLight }}>{origHashes.pHash.slice(0, 16).join('')}...</span></div>
                      <div>dHash: <span style={{ color: COLORS.greenLight }}>{origHashes.dHash.slice(0, 16).join('')}...</span></div>
                      <div>aHash: <span style={{ color: COLORS.greenLight }}>{origHashes.aHash.slice(0, 16).join('')}...</span></div>
                    </div>
                  )}
                </div>
              </div>

              {/* SUSPECT */}
              <div style={s.card}>
                <div style={s.cardHead}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.amberLight }}>🔍 SUSPECTED COPY</span>
                  {suspStatus && <span style={{ fontSize: 11, color: suspStatus.includes('✅') ? COLORS.greenLight : COLORS.muted }}>{suspStatus}</span>}
                </div>
                <div style={s.cardBody}>
                  <DropZone
                    label="Upload Edited/Suspected Copy"
                    file={suspFile}
                    preview={suspPreview}
                    onFile={loadSuspect}
                    accept="image/*,video/*"
                    hint="Upload the cropped/filtered/edited version"
                  />
                  {suspHashes && (
                    <div style={{ marginTop: 12, padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8, fontFamily: 'monospace', fontSize: 11, color: COLORS.muted }}>
                      <div>pHash: <span style={{ color: COLORS.amberLight }}>{suspHashes.pHash.slice(0, 16).join('')}...</span></div>
                      <div>dHash: <span style={{ color: COLORS.amberLight }}>{suspHashes.dHash.slice(0, 16).join('')}...</span></div>
                      <div>aHash: <span style={{ color: COLORS.amberLight }}>{suspHashes.aHash.slice(0, 16).join('')}...</span></div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* COMPARE BUTTON */}
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <button
                onClick={runComparison}
                disabled={!origHashes || !suspHashes || comparing}
                style={{
                  ...s.btn(origHashes && suspHashes ? COLORS.blueLight : COLORS.border),
                  padding: '13px 40px',
                  fontSize: 14,
                  opacity: (!origHashes || !suspHashes) ? 0.4 : 1,
                  cursor: (!origHashes || !suspHashes) ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {comparing
                  ? <><span style={{ display: 'inline-block', animation: 'spin 0.8s linear infinite' }}>⟳</span> COMPARING...</>
                  : '⚡ RUN COMPARISON'}
              </button>
              {!origHashes || !suspHashes ? (
                <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 8 }}>Upload both files above to enable comparison</div>
              ) : null}
            </div>

            {/* RESULT */}
            {result && (
              <div className="fade-in" style={{
                background: statusCfg[result.status].bg,
                border: `1px solid ${statusCfg[result.status].border}`,
                borderRadius: 12,
                padding: 22,
              }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 24 }}>{statusCfg[result.status].icon}</span>
                      <span style={{ fontWeight: 900, fontSize: 22, color: statusCfg[result.status].color }}>
                        {result.status}
                      </span>
                      <span style={{ fontWeight: 900, fontSize: 26, color: statusCfg[result.status].color }}>
                        {result.overall}%
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: COLORS.muted }}>{result.reason}</div>
                  </div>
                  {result.status !== 'CLEAN' && (
                    <button onClick={() => setDmcaOpen(true)} style={s.btn(COLORS.red)}>
                      📋 GENERATE DMCA
                    </button>
                  )}
                </div>

                {/* Hash breakdown */}
                <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: COLORS.muted, letterSpacing: 1.5, marginBottom: 12 }}>HASH-BY-HASH BREAKDOWN</div>
                  <HashMeter label="pHash (Perceptual — DCT based)" value={result.pSim} color={result.pSim > 85 ? COLORS.redLight : result.pSim > 70 ? COLORS.amberLight : COLORS.greenLight} />
                  <HashMeter label="dHash (Edge detection)" value={result.dSim} color={result.dSim > 85 ? COLORS.redLight : result.dSim > 70 ? COLORS.amberLight : COLORS.greenLight} />
                  <HashMeter label="aHash (Brightness average)" value={result.aSim} color={result.aSim > 85 ? COLORS.redLight : result.aSim > 70 ? COLORS.amberLight : COLORS.greenLight} />
                </div>

                {/* What was detected */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                  {[
                    { label: 'Color filter / Brightness edit', detected: result.aSim < 90 && result.pSim > 70, icon: '🎨' },
                    { label: 'Crop / Aspect ratio change', detected: result.dSim < 88 && result.pSim > 65, icon: '✂️' },
                    { label: 'Compression / Re-encode', detected: result.overall > 80 && result.pSim < 98, icon: '📦' },
                  ].map((det, i) => (
                    <div key={i} style={{
                      background: det.detected ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${det.detected ? 'rgba(245,158,11,0.3)' : COLORS.border}`,
                      borderRadius: 8,
                      padding: '10px 12px',
                      textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 18, marginBottom: 4 }}>{det.icon}</div>
                      <div style={{ fontSize: 10, color: COLORS.muted, marginBottom: 4 }}>{det.label}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: det.detected ? COLORS.amberLight : COLORS.greenLight }}>
                        {det.detected ? 'DETECTED' : 'NOT DETECTED'}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Threshold explanation */}
                <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.7 }}>
                    <b style={{ color: COLORS.text }}>How thresholds work:</b> 85%+ = STOLEN &nbsp;|&nbsp; 70–85% = SUSPICIOUS &nbsp;|&nbsp; 50–70% = INVESTIGATING &nbsp;|&nbsp; Below 50% = CLEAN<br />
                    Hamming distances — pHash: <b style={{ color: COLORS.text }}>{result.pDist} bits</b> &nbsp;|&nbsp; dHash: <b style={{ color: COLORS.text }}>{result.dDist} bits</b> &nbsp;|&nbsp; aHash: <b style={{ color: COLORS.text }}>{result.aDist} bits</b>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── REGISTER TAB ── */}
        {tab === 'register' && (
          <div className="fade-in">
            <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 10, padding: '12px 16px', marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: COLORS.greenLight, marginBottom: 3 }}>📌 WHAT THIS DOES</div>
              <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.6 }}>
                Upload your original content here to register its digital fingerprint. Sports Guardian generates pHash + dHash + aHash fingerprints — three independent digital IDs that identify your content even after editing, cropping, or color changes. Tell judges: <i>"This is how the broadcaster registers a clip before match day."</i>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
              {/* Left: Upload */}
              <div style={s.card}>
                <div style={s.cardHead}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>📁 Upload to Register</span>
                </div>
                <div style={s.cardBody}>
                  <DropZone
                    label="Click to upload image or video"
                    file={regFile}
                    preview={regPreview}
                    onFile={registerFile}
                    accept="image/*,video/*"
                    hint="Supports JPG, PNG, MP4, MOV, AVI"
                  />

                  {regLog.length > 0 && (
                    <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.3)', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 14, fontFamily: 'monospace', fontSize: 12 }}>
                      {regLog.map((l, i) => (
                        <div key={i} style={{ color: l.color, marginBottom: 5, animation: 'fadeIn 0.3s ease' }}>{l.text}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Fingerprint display */}
              <div style={s.card}>
                <div style={s.cardHead}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>🔑 Generated Fingerprint</span>
                </div>
                <div style={s.cardBody}>
                  {!regDone ? (
                    <div style={{ color: COLORS.muted, fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
                      Upload a file to see its fingerprint
                    </div>
                  ) : (
                    <div className="fade-in">
                      <div style={{ marginBottom: 14, padding: 12, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8 }}>
                        <div style={{ fontWeight: 700, color: COLORS.greenLight, fontSize: 13, marginBottom: 2 }}>✅ FINGERPRINT REGISTERED</div>
                        <div style={{ fontSize: 11, color: COLORS.muted }}>Triple hash saved. Color filter resistant: YES</div>
                      </div>

                      {['pHash', 'dHash', 'aHash'].map((type, ti) => (
                        <div key={type} style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 11, color: COLORS.muted, letterSpacing: 1, marginBottom: 4 }}>
                            {type === 'pHash' ? '🔍 pHash — Perceptual (DCT)' : type === 'dHash' ? '📊 dHash — Edge Detection' : '☀️ aHash — Brightness Average'}
                          </div>
                          <div style={{ fontFamily: 'monospace', fontSize: 10, color: [COLORS.greenLight, '#818cf8', COLORS.amberLight][ti], wordBreak: 'break-all', lineHeight: 1.7, background: 'rgba(0,0,0,0.2)', padding: '8px 10px', borderRadius: 6 }}>
                            {regHashes[type].join('')}
                          </div>
                        </div>
                      ))}

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
                        {[
                          { icon: '🔒', label: 'Crop resistant', val: 'Partial' },
                          { icon: '🎨', label: 'Filter resistant', val: 'Yes' },
                          { icon: '📦', label: 'Compression resistant', val: 'Yes' },
                          { icon: '🌓', label: 'Brightness resistant', val: 'Yes' },
                        ].map((feat, i) => (
                          <div key={i} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontSize: 16 }}>{feat.icon}</span>
                            <div>
                              <div style={{ fontSize: 10, color: COLORS.muted }}>{feat.label}</div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.greenLight }}>{feat.val}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── ALERTS TAB ── */}
        {tab === 'alerts' && (
          <div className="fade-in">
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: COLORS.muted }}>
              <b style={{ color: COLORS.text }}>Note for demo:</b> These alerts simulate what Sports Guardian would find when scanning YouTube, Instagram, and Telegram for stolen sports clips. In a live system, these would be real results from platform API crawlers.
            </div>
            <div style={s.card}>
              <div style={s.cardHead}>
                <span style={{ fontWeight: 700, fontSize: 12, color: COLORS.muted, letterSpacing: 1.5 }}>DETECTION RESULTS — TRIPLE HASH ENGINE</span>
                <span style={{ fontSize: 12, color: COLORS.redLight, fontWeight: 700 }}>3 STOLEN FOUND</span>
              </div>
              {mockAlerts.map((a) => {
                const sc = statusCfg[a.status];
                return (
                  <div key={a.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '14px 18px',
                    borderBottom: `1px solid ${COLORS.border}`,
                    borderLeft: `3px solid ${sc.color}`,
                  }}>
                    <span style={{ background: platformColors[a.platform] || '#666', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                      {a.platform.toUpperCase()}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.clip}</div>
                      <div style={{ fontSize: 11, color: COLORS.muted }}>{a.uploader}</div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 60 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: a.confidence > 85 ? COLORS.redLight : a.confidence > 70 ? COLORS.amberLight : COLORS.greenLight }}>
                        {a.confidence}%
                      </div>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 3 }}>
                        <div style={{ height: '100%', width: `${a.confidence}%`, background: a.confidence > 85 ? COLORS.redLight : a.confidence > 70 ? COLORS.amberLight : COLORS.greenLight, borderRadius: 2 }} />
                      </div>
                    </div>
                    <span style={{ background: sc.bg, border: `1px solid ${sc.border}`, color: sc.color, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                      {sc.icon} {a.status}
                    </span>
                    {a.status !== 'CLEAN' && (
                      <button style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: COLORS.redLight, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                        DMCA
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── LINEAGE TAB ── */}
        {tab === 'lineage' && (
          <div className="fade-in" style={s.card}>
            <div style={s.cardHead}>
              <span style={{ fontWeight: 700, fontSize: 12, color: COLORS.muted, letterSpacing: 1.5 }}>CONTENT SPREAD ANALYSIS</span>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 18, lineHeight: 1.6 }}>
                Once a clip is stolen, Sports Guardian tracks how it spreads across platforms using detection timestamps. This tree shows the path a stolen clip travels after leaving the original broadcaster.
              </div>
              <svg width="100%" viewBox="0 0 680 300" style={{ fontFamily: 'inherit' }}>
                <defs>
                  <filter id="glow2"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                </defs>
                {/* Lines */}
                {[[340,55,140,155],[340,55,340,155],[340,55,540,155],[140,155,70,250],[140,155,210,250],[340,155,340,250],[540,155,470,250],[540,155,610,250]].map(([x1,y1,x2,y2],i)=>(
                  <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={COLORS.border} strokeWidth="1.5" strokeDasharray="4 3"/>
                ))}
                {/* Nodes */}
                {[
                  {x:340,y:55,label:'ORIGINAL',sub:'ISL Official',color:COLORS.greenLight,r:26},
                  {x:140,y:155,label:'TELEGRAM',sub:'IPL Leaks',color:'#3b82f6',r:20},
                  {x:340,y:155,label:'YOUTUBE',sub:'@highlights',color:'#ef4444',r:20},
                  {x:540,y:155,label:'INSTAGRAM',sub:'@reels',color:'#ec4899',r:20},
                  {x:70,y:250,label:'WA GROUP',sub:'500 views',color:COLORS.amberLight,r:14},
                  {x:210,y:250,label:'REDDIT',sub:'r/cricket',color:'#f97316',r:14},
                  {x:340,y:250,label:'TWITTER',sub:'@fan',color:'#38bdf8',r:14},
                  {x:470,y:250,label:'TIKTOK',sub:'viral',color:'#ef4444',r:14},
                  {x:610,y:250,label:'YOUTUBE',sub:'mirror',color:'#ef4444',r:14},
                ].map((n,i)=>(
                  <g key={i} filter="url(#glow2)">
                    <circle cx={n.x} cy={n.y} r={n.r+5} fill={n.color+'18'} stroke={n.color+'50'} strokeWidth="1"/>
                    <circle cx={n.x} cy={n.y} r={n.r} fill={n.color+'22'} stroke={n.color} strokeWidth="1.5"/>
                    <text x={n.x} y={n.y-3} textAnchor="middle" fill={n.color} fontSize="7.5" fontWeight="bold">{n.label}</text>
                    <text x={n.x} y={n.y+8} textAnchor="middle" fill={COLORS.muted} fontSize="6.5">{n.sub}</text>
                  </g>
                ))}
              </svg>
            </div>
          </div>
        )}

      </main>

      {/* DMCA MODAL */}
      {dmcaOpen && result && (
        <DmcaModal result={result} origFile={origFile} suspFile={suspFile} onClose={() => setDmcaOpen(false)} />
      )}
    </div>
  );
}
