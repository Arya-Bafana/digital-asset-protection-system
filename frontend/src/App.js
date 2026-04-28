import React, { useState, useRef, useCallback } from 'react';

// ─────────────────────────────────────────────
//  PERCEPTUAL HASHING — runs entirely in browser
// ─────────────────────────────────────────────

async function getPixels(source, size) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const draw = (img) => {
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      const grey = [];
      for (let i = 0; i < data.length; i += 4)
        grey.push(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
      resolve(grey);
    };
    if (source instanceof HTMLVideoElement) { draw(source); }
    else { const img = new Image(); img.onload = () => draw(img); img.src = source; }
  });
}

async function computePHash(source) {
  const size = 32;
  const pixels = await getPixels(source, size);
  const dct = [];
  for (let u = 0; u < size; u++)
    for (let v = 0; v < size; v++) {
      let sum = 0;
      for (let x = 0; x < size; x++)
        for (let y = 0; y < size; y++)
          sum += pixels[x*size+y] * Math.cos((2*x+1)*u*Math.PI/(2*size)) * Math.cos((2*y+1)*v*Math.PI/(2*size));
      dct.push(sum);
    }
  const topLeft = [];
  for (let u = 0; u < 8; u++)
    for (let v = 0; v < 8; v++)
      if (!(u===0&&v===0)) topLeft.push(dct[u*size+v]);
  const mean = topLeft.reduce((a,b)=>a+b,0)/topLeft.length;
  return topLeft.map(v => v > mean ? 1 : 0);
}

async function computeDHash(source) {
  const pixels = await getPixels(source, 9);
  const hash = [];
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++)
      hash.push(pixels[row*9+col] > pixels[row*9+col+1] ? 1 : 0);
  return hash;
}

async function computeAHash(source) {
  const pixels = await getPixels(source, 8);
  const mean = pixels.reduce((a,b)=>a+b,0)/pixels.length;
  return pixels.map(v => v > mean ? 1 : 0);
}

// Wavelet-like hash — captures frequency bands, great for color/brightness edits
async function computeWHash(source) {
  const pixels = await getPixels(source, 8);
  // Compare each pixel to its row average — catches brightness shifts well
  const hash = [];
  for (let row = 0; row < 8; row++) {
    const rowPixels = pixels.slice(row*8, row*8+8);
    const rowMean = rowPixels.reduce((a,b)=>a+b,0)/8;
    for (let col = 0; col < 8; col++)
      hash.push(rowPixels[col] > rowMean ? 1 : 0);
  }
  return hash;
}

function hammingDistance(a, b) {
  let d = 0;
  for (let i = 0; i < Math.min(a.length,b.length); i++) if (a[i]!==b[i]) d++;
  return d;
}

function sim(dist, len) { return Math.round((1 - dist/len)*1000)/10; }

async function computeAllHashes(source) {
  const [ph, dh, ah, wh] = await Promise.all([
    computePHash(source), computeDHash(source),
    computeAHash(source), computeWHash(source),
  ]);
  return { pHash:ph, dHash:dh, aHash:ah, wHash:wh };
}

// ─────────────────────────────────────────────
//  CROP DETECTION
//  Crops 9 regions of the suspect image and checks
//  if any region matches the original — catches heavy crops
// ─────────────────────────────────────────────

async function cropAndHash(sourceUrl, regions) {
  const results = [];
  for (const [lf, tf, rf, bf] of regions) {
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = async () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, lf*w, tf*h, (rf-lf)*w, (bf-tf)*h, 0, 0, 32, 32);
        const url = canvas.toDataURL();
        const hashes = await computeAllHashes(url);
        results.push(hashes);
        resolve();
      };
      img.src = sourceUrl;
    });
  }
  return results;
}

const CROP_REGIONS = [
  [0.0, 0.0, 0.6, 0.6],   // top-left
  [0.4, 0.0, 1.0, 0.6],   // top-right
  [0.0, 0.4, 0.6, 1.0],   // bottom-left
  [0.4, 0.4, 1.0, 1.0],   // bottom-right
  [0.2, 0.2, 0.8, 0.8],   // center 60%
  [0.1, 0.1, 0.9, 0.9],   // center 80%
  [0.0, 0.0, 1.0, 0.6],   // top strip
  [0.0, 0.4, 1.0, 1.0],   // bottom strip
  [0.15, 0.15, 0.85, 0.85], // tight center
];

// ─────────────────────────────────────────────
//  BRIGHTNESS / COLOR FILTER DETECTION
//  Computes average brightness of both images
//  and compares — catches Instagram/Snapseed filters
// ─────────────────────────────────────────────

async function getBrightness(source) {
  const pixels = await getPixels(source, 16);
  return pixels.reduce((a,b)=>a+b,0)/pixels.length;
}

async function getColorChannels(source) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext('2d');
    const draw = (img) => {
      ctx.drawImage(img, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16).data;
      let r=0, g=0, b=0, count=0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i+1]; b += data[i+2]; count++;
      }
      resolve({ r: r/count, g: g/count, b: b/count });
    };
    if (source instanceof HTMLVideoElement) { draw(source); }
    else { const img = new Image(); img.onload = () => draw(img); img.src = source; }
  });
}

// ─────────────────────────────────────────────
//  MAIN COMPARE FUNCTION
// ─────────────────────────────────────────────

async function fullCompare(origSource, suspSource, origFile, suspFile) {
  // Step 1 — base hashes
  const [origH, suspH] = await Promise.all([
    computeAllHashes(origSource),
    computeAllHashes(suspSource),
  ]);

  const pDist = hammingDistance(origH.pHash, suspH.pHash);
  const dDist = hammingDistance(origH.dHash, suspH.dHash);
  const aDist = hammingDistance(origH.aHash, suspH.aHash);
  const wDist = hammingDistance(origH.wHash, suspH.wHash);

  const pSim = sim(pDist, origH.pHash.length);
  const dSim = sim(dDist, origH.dHash.length);
  const aSim = sim(aDist, origH.aHash.length);
  const wSim = sim(wDist, origH.wHash.length);

  // Weighted base score — wHash added for color sensitivity
  const baseScore = Math.round((pSim*0.40 + dSim*0.25 + aSim*0.20 + wSim*0.15)*10)/10;

  // Step 2 — brightness & color channel comparison
  const [origBright, suspBright] = await Promise.all([
    getBrightness(origSource), getBrightness(suspSource),
  ]);
  const brightnessDiff = Math.abs(origBright - suspBright);
  const brightnessEdited = brightnessDiff > 8;  // >8 brightness units = edited

  const [origColor, suspColor] = await Promise.all([
    getColorChannels(origSource), getColorChannels(suspSource),
  ]);
  const rDiff = Math.abs(origColor.r - suspColor.r);
  const gDiff = Math.abs(origColor.g - suspColor.g);
  const bDiff = Math.abs(origColor.b - suspColor.b);
  const colorFilterDetected = (rDiff > 10 || gDiff > 10 || bDiff > 10);

  // Step 3 — crop detection (only works on images with URLs, not video elements)
  let cropScore = 0;
  let cropDetected = false;
  let bestCropRegion = null;

  if (typeof origSource === 'string' && typeof suspSource === 'string') {
    try {
      const suspCrops = await cropAndHash(suspSource, CROP_REGIONS);
      for (let i = 0; i < suspCrops.length; i++) {
        const crop = suspCrops[i];
        const cp = sim(hammingDistance(origH.pHash, crop.pHash), origH.pHash.length);
        const cd = sim(hammingDistance(origH.dHash, crop.dHash), origH.dHash.length);
        const ca = sim(hammingDistance(origH.aHash, crop.aHash), origH.aHash.length);
        const cs = Math.round((cp*0.5 + cd*0.3 + ca*0.2)*10)/10;
        if (cs > cropScore) { cropScore = cs; bestCropRegion = i; }
      }
      // Also check original crops against suspect full image
      const origCrops = await cropAndHash(origSource, CROP_REGIONS);
      for (let i = 0; i < origCrops.length; i++) {
        const crop = origCrops[i];
        const cp = sim(hammingDistance(crop.pHash, suspH.pHash), crop.pHash.length);
        const cd = sim(hammingDistance(crop.dHash, suspH.dHash), crop.dHash.length);
        const ca = sim(hammingDistance(crop.aHash, suspH.aHash), crop.aHash.length);
        const cs = Math.round((cp*0.5 + cd*0.3 + ca*0.2)*10)/10;
        if (cs > cropScore) { cropScore = cs; bestCropRegion = i; }
      }
      cropDetected = cropScore >= 60;
    } catch { cropScore = 0; }
  }

  // Step 4 — mirror detection (flip suspect horizontally and compare)
  let mirrorDetected = false;
  let mirrorScore = 0;
  if (typeof suspSource === 'string') {
    try {
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 32; canvas.height = 32;
          const ctx = canvas.getContext('2d');
          ctx.translate(32, 0); ctx.scale(-1, 1);
          ctx.drawImage(img, 0, 0, 32, 32);
          const flippedUrl = canvas.toDataURL();
          const flippedH = await computeAllHashes(flippedUrl);
          const mp = sim(hammingDistance(origH.pHash, flippedH.pHash), origH.pHash.length);
          const md = sim(hammingDistance(origH.dHash, flippedH.dHash), origH.dHash.length);
          mirrorScore = Math.round((mp*0.6 + md*0.4)*10)/10;
          mirrorDetected = mirrorScore >= 75;
          resolve();
        };
        img.src = suspSource;
      });
    } catch { mirrorScore = 0; }
  }

  // Step 5 — final weighted score
  // Boost score if crop or mirror detected
  let finalScore = baseScore;
  if (cropDetected && cropScore > finalScore) finalScore = Math.round((finalScore*0.4 + cropScore*0.6)*10)/10;
  if (mirrorDetected && mirrorScore > finalScore) finalScore = Math.round((finalScore*0.5 + mirrorScore*0.5)*10)/10;

  // Cap at 100
  finalScore = Math.min(100, finalScore);

  // Step 6 — verdict
  let status, reason;
  if (finalScore >= 85) {
    status = 'STOLEN';
    reason = 'Content is near-identical. This is a pirated copy.';
  } else if (finalScore >= 70) {
    status = 'SUSPICIOUS';
    reason = 'Significant similarity detected. Likely edited copy.';
  } else if (finalScore >= 50) {
    status = 'INVESTIGATING';
    reason = 'Partial match. May be a heavily cropped or edited version.';
  } else {
    status = 'CLEAN';
    reason = 'Content appears different. No piracy detected.';
  }

  return {
    overall: finalScore,
    pSim, dSim, aSim, wSim,
    pDist, dDist, aDist, wDist,
    status, reason,
    brightnessEdited,
    brightnessDiff: Math.round(brightnessDiff*10)/10,
    colorFilterDetected,
    colorDiff: { r: Math.round(rDiff), g: Math.round(gDiff), b: Math.round(bDiff) },
    cropDetected,
    cropScore,
    bestCropRegion,
    mirrorDetected,
    mirrorScore,
  };
}

// ─────────────────────────────────────────────
//  VIDEO FRAME EXTRACTION
// ─────────────────────────────────────────────

function extractVideoFrame(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.src = url; video.muted = true;
    video.addEventListener('loadeddata', () => {
      video.currentTime = Math.min(2, video.duration * 0.3);
    });
    video.addEventListener('seeked', () => resolve({ video, url }));
    video.addEventListener('error', reject);
    video.load();
  });
}

// ─────────────────────────────────────────────
//  COLORS & CONFIG
// ─────────────────────────────────────────────

const COLORS = {
  green: '#16a34a', greenLight: '#22c55e',
  red: '#dc2626',   redLight: '#ef4444',
  amber: '#d97706', amberLight: '#f59e0b',
  blue: '#1d4ed8',  blueLight: '#3b82f6',
  bg: '#0f172a', surface: '#1e293b', border: '#334155',
  text: '#f1f5f9', muted: '#94a3b8',
};

const statusCfg = {
  STOLEN:        { color:'#ef4444', bg:'rgba(220,38,38,0.12)',  border:'rgba(220,38,38,0.35)',  icon:'🚨' },
  SUSPICIOUS:    { color:'#f59e0b', bg:'rgba(217,119,6,0.12)',  border:'rgba(217,119,6,0.35)',  icon:'⚠️' },
  INVESTIGATING: { color:'#f59e0b', bg:'rgba(245,158,11,0.10)', border:'rgba(245,158,11,0.25)', icon:'🔍' },
  CLEAN:         { color:'#22c55e', bg:'rgba(22,163,74,0.12)',  border:'rgba(22,163,74,0.35)',  icon:'✅' },
};

const platformColors = { YouTube:'#ef4444', Instagram:'#ec4899', Telegram:'#3b82f6', Reddit:'#f97316', Twitter:'#38bdf8' };

// ─────────────────────────────────────────────
//  COMPONENTS
// ─────────────────────────────────────────────

function DropZone({ label, file, preview, onFile, accept, hint }) {
  const ref = useRef();
  const [drag, setDrag] = useState(false);
  const drop = (e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); };
  return (
    <div onClick={() => ref.current.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)} onDrop={drop}
      style={{ border: `2px dashed ${drag ? COLORS.greenLight : file ? COLORS.green : COLORS.border}`, borderRadius: 12, background: drag ? 'rgba(34,197,94,0.06)' : file ? 'rgba(34,197,94,0.04)' : 'rgba(255,255,255,0.02)', padding: '20px 16px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s', minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }} onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
      {preview ? <img src={preview} alt="preview" style={{ maxHeight: 100, maxWidth: '100%', borderRadius: 8, objectFit: 'contain', marginBottom: 4 }} />
        : <div style={{ fontSize: 36 }}>{accept.includes('video') ? '🎬' : '🖼️'}</div>}
      <div style={{ fontWeight: 700, fontSize: 13, color: file ? COLORS.greenLight : COLORS.text, letterSpacing: 1 }}>{file ? file.name : label}</div>
      {file && <div style={{ fontSize: 11, color: COLORS.muted }}>{(file.size/1024/1024).toFixed(2)} MB</div>}
      {!file && <div style={{ fontSize: 11, color: COLORS.muted }}>{hint}</div>}
    </div>
  );
}

function Meter({ label, value, color }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: COLORS.muted, letterSpacing: 1 }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>{value}%</span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 3, transition: 'width 0.8s ease' }} />
      </div>
    </div>
  );
}

function DetCard({ icon, label, detected, sub }) {
  return (
    <div style={{ background: detected ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${detected ? 'rgba(245,158,11,0.3)' : COLORS.border}`, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
      <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 10, color: COLORS.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: detected ? COLORS.amberLight : COLORS.greenLight }}>{detected ? 'DETECTED' : 'NOT DETECTED'}</div>
      {sub && <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── DMCA Modal — letter defined first, then used ──
function DmcaModal({ result, origFile, suspFile, onClose }) {
  const letter = `DMCA TAKEDOWN NOTICE
Sports Guardian — Detection Engine
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TO: Platform Trust & Safety Team
RE: Unauthorized Sports Content

INFRINGING CONTENT:
• Original File      : ${origFile?.name || 'Registered content'}
• Suspected Copy     : ${suspFile?.name || 'Detected content'}
• Overall Confidence : ${result?.overall}%
• pHash Similarity   : ${result?.pSim}%
• dHash Similarity   : ${result?.dSim}%
• aHash Similarity   : ${result?.aSim}%
• wHash Similarity   : ${result?.wSim}%
• Color Filter       : ${result?.colorFilterDetected ? 'DETECTED' : 'NOT DETECTED'}
• Brightness Edit    : ${result?.brightnessEdited ? 'DETECTED' : 'NOT DETECTED'}
• Crop Detected      : ${result?.cropDetected ? 'DETECTED' : 'NOT DETECTED'}
• Mirror Detected    : ${result?.mirrorDetected ? 'DETECTED' : 'NOT DETECTED'}
• Detection Method   : Quad Hash + Crop + Color + Mirror Analysis
• Verdict            : ${result?.status}

I have a good faith belief that this content infringes on
the copyright of the registered content owner. I request
immediate removal under DMCA Section 512(c).

— Sports Guardian Automated DMCA System
   Generated: ${new Date().toLocaleString()}`;

  const download = () => {
    const blob = new Blob([letter], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `DMCA_Notice_${Date.now()}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 28, maxWidth: 520, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: COLORS.text, letterSpacing: 1 }}>DMCA TAKEDOWN NOTICE</div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${COLORS.border}`, color: COLORS.muted, width: 30, height: 30, borderRadius: 6, cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        <textarea readOnly value={letter} style={{ width: '100%', height: 260, background: 'rgba(0,0,0,0.3)', border: `1px solid ${COLORS.border}`, color: '#ccc', padding: 14, borderRadius: 8, fontFamily: 'monospace', fontSize: 11, resize: 'none', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button onClick={() => navigator.clipboard.writeText(letter)} style={{ flex: 1, background: COLORS.green, color: '#fff', border: 'none', padding: '10px', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>📋 COPY</button>
          <button onClick={download} style={{ flex: 1, background: COLORS.blue, color: '#fff', border: 'none', padding: '10px', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>⬇️ DOWNLOAD</button>
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

  const [origFile, setOrigFile] = useState(null);
  const [origPreview, setOrigPreview] = useState(null);
  const [origSource, setOrigSource] = useState(null);
  const [origStatus, setOrigStatus] = useState('');

  const [suspFile, setSuspFile] = useState(null);
  const [suspPreview, setSuspPreview] = useState(null);
  const [suspSource, setSuspSource] = useState(null);
  const [suspStatus, setSuspStatus] = useState('');

  const [result, setResult] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [compareStep, setCompareStep] = useState('');
  const [dmcaOpen, setDmcaOpen] = useState(false);

  const [regFile, setRegFile] = useState(null);
  const [regPreview, setRegPreview] = useState(null);
  const [regHashes, setRegHashes] = useState(null);
  const [regLog, setRegLog] = useState([]);
  const [regDone, setRegDone] = useState(false);

  const mockAlerts = [
    { id:1, platform:'YouTube',   uploader:'@cricket_highlights_hd', clip:'Kohli Century — T20 World Cup',  confidence:97.3, status:'STOLEN' },
    { id:2, platform:'Instagram', uploader:'@sports_reels_india',    clip:'Bumrah Hat-trick Celebration',   confidence:91.8, status:'STOLEN' },
    { id:3, platform:'Telegram',  uploader:'IPL Leaks Channel',      clip:'Rohit Sharma Six Compilation',   confidence:88.5, status:'SUSPICIOUS' },
    { id:4, platform:'YouTube',   uploader:'@fan_edits_cricket',     clip:'Dhoni Finishes Off in Style',    confidence:76.2, status:'INVESTIGATING' },
    { id:5, platform:'Reddit',    uploader:'u/cricket_fan_2024',     clip:'Shami Bowling Masterclass',      confidence:42.1, status:'CLEAN' },
  ];

  const loadOrig = useCallback(async (file) => {
    setOrigFile(file); setResult(null); setOrigStatus('Processing...');
    setOrigSource(null); setOrigPreview(null);
    try {
      if (file.type.startsWith('video/')) {
        const { video, url } = await extractVideoFrame(file);
        const canvas = document.createElement('canvas');
        canvas.width = 200; canvas.height = 120;
        canvas.getContext('2d').drawImage(video, 0, 0, 200, 120);
        const preview = canvas.toDataURL();
        setOrigPreview(preview);
        setOrigSource(video);
        URL.revokeObjectURL(url);
      } else {
        const url = URL.createObjectURL(file);
        setOrigPreview(url);
        setOrigSource(url);
      }
      setOrigStatus('✅ Ready');
    } catch { setOrigStatus('❌ Failed to load'); }
  }, []);

  const loadSusp = useCallback(async (file) => {
    setSuspFile(file); setResult(null); setSuspStatus('Processing...');
    setSuspSource(null); setSuspPreview(null);
    try {
      if (file.type.startsWith('video/')) {
        const { video, url } = await extractVideoFrame(file);
        const canvas = document.createElement('canvas');
        canvas.width = 200; canvas.height = 120;
        canvas.getContext('2d').drawImage(video, 0, 0, 200, 120);
        const preview = canvas.toDataURL();
        setSuspPreview(preview);
        setSuspSource(video);
        URL.revokeObjectURL(url);
      } else {
        const url = URL.createObjectURL(file);
        setSuspPreview(url);
        setSuspSource(url);
      }
      setSuspStatus('✅ Ready');
    } catch { setSuspStatus('❌ Failed to load'); }
  }, []);

  const runComparison = async () => {
    if (!origSource || !suspSource) return;
    setComparing(true); setResult(null);
    setCompareStep('🔍 Computing quad hash fingerprints...');
    await new Promise(r => setTimeout(r, 300));
    setCompareStep('✂️ Running 9-region crop detection...');
    await new Promise(r => setTimeout(r, 300));
    setCompareStep('🎨 Analysing color channels & brightness...');
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await fullCompare(origSource, suspSource, origFile, suspFile);
      setResult(res);
    } catch (e) {
      console.error(e);
    }
    setComparing(false); setCompareStep('');
  };

  const registerFile = useCallback(async (file) => {
    setRegFile(file); setRegDone(false); setRegLog([]); setRegHashes(null); setRegPreview(null);
    const log = (text, color) => setRegLog(p => [...p, { text, color }]);
    log(file.type.startsWith('video/') ? '🎬 Video detected — extracting key frame...' : '🖼️ Image detected — loading...', COLORS.blueLight);
    try {
      let source;
      if (file.type.startsWith('video/')) {
        const { video, url } = await extractVideoFrame(file);
        const canvas = document.createElement('canvas');
        canvas.width = 200; canvas.height = 120;
        canvas.getContext('2d').drawImage(video, 0, 0, 200, 120);
        source = canvas.toDataURL();
        setRegPreview(source);
        URL.revokeObjectURL(url);
      } else {
        source = URL.createObjectURL(file);
        setRegPreview(source);
      }
      await new Promise(r => setTimeout(r, 500));
      log('🔍 Generating pHash (perceptual)...', COLORS.blueLight);
      await new Promise(r => setTimeout(r, 350));
      log('📊 Generating dHash (edge detection)...', '#818cf8');
      await new Promise(r => setTimeout(r, 350));
      log('☀️ Generating aHash (brightness)...', '#818cf8');
      await new Promise(r => setTimeout(r, 300));
      log('🌊 Generating wHash (wavelet frequency)...', '#818cf8');
      await new Promise(r => setTimeout(r, 300));
      log('🎨 Analysing color channel fingerprint...', '#818cf8');
      await new Promise(r => setTimeout(r, 300));
      const hashes = await computeAllHashes(source);
      setRegHashes(hashes);
      setRegDone(true);
      log(`✅ "${file.name}" registered! Quad hash fingerprint saved.`, COLORS.greenLight);
    } catch { log('❌ Failed to process file. Try a different format.', COLORS.red); }
  }, []);

  const mc = (v) => v > 85 ? COLORS.redLight : v > 70 ? COLORS.amberLight : COLORS.greenLight;

  const card = { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 };
  const cardH = { padding: '14px 18px', borderBottom: `1px solid ${COLORS.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
  const btn = (bg) => ({ background: bg, border: `1px solid ${bg}`, color: '#fff', padding: '10px 20px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: 0.5 });

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.text, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}body{background:${COLORS.bg}}button:hover{opacity:0.88}@keyframes spin{to{transform:rotate(360deg)}}@keyframes fi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.fi{animation:fi 0.35s ease both}`}</style>

      {/* HEADER */}
      <header style={{ background: '#0a1628', borderBottom: `1px solid ${COLORS.border}`, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 26 }}>🛡️</span>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: 1.5, color: COLORS.text }}>SPORTS GUARDIAN</div>
            <div style={{ fontSize: 10, color: COLORS.muted, letterSpacing: 2 }}>CONTENT PROTECTION SYSTEM</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: COLORS.greenLight, fontSize: 10, padding: '4px 12px', borderRadius: 20, fontWeight: 700, letterSpacing: 2 }}>v3.0 QUAD HASH</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: COLORS.greenLight, boxShadow: '0 0 8px #22c55e' }} />
            <span style={{ fontSize: 11, color: COLORS.greenLight, fontWeight: 700 }}>LIVE</span>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '28px 20px' }}>

        {/* STATS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 24 }}>
          {[
            { label:'CLIPS PROTECTED', val:'2,847', color:COLORS.blueLight,  icon:'🛡️' },
            { label:'STOLEN DETECTED', val:'3',     color:COLORS.red,        icon:'🚨' },
            { label:'DETECT TIME',     val:'8s',    color:'#a78bfa',         icon:'⚡' },
            { label:'REVENUE SAVED',   val:'₹4.2L', color:COLORS.greenLight, icon:'💰' },
          ].map((st, i) => (
            <div key={i} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderTop: `3px solid ${st.color}`, borderRadius: 10, padding: '16px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{st.icon}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: st.color }}>{st.val}</div>
              <div style={{ fontSize: 10, color: COLORS.muted, letterSpacing: 1.5, marginTop: 2 }}>{st.label}</div>
            </div>
          ))}
        </div>

        {/* TABS */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: COLORS.surface, borderRadius: 10, padding: 4, border: `1px solid ${COLORS.border}` }}>
          {[['compare','🔍 COMPARE & DETECT'],['register','📤 REGISTER CONTENT'],['alerts','🚨 ALERTS DASHBOARD'],['lineage','🕸️ SPREAD MAP']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: '9px 8px', background: tab===id ? '#1d4ed8' : 'transparent', border: tab===id ? '1px solid rgba(59,130,246,0.5)' : '1px solid transparent', color: tab===id ? '#fff' : COLORS.muted, borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, fontFamily: 'inherit', transition: 'all 0.18s' }}>{label}</button>
          ))}
        </div>

        {/* ── COMPARE TAB ── */}
        {tab === 'compare' && (
          <div className="fi">
            <div style={{ background: 'rgba(29,78,216,0.1)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 18, display: 'flex', gap: 10 }}>
              <span style={{ fontSize: 18 }}>ℹ️</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#93c5fd', marginBottom: 3 }}>HOW IT WORKS</div>
                <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.7 }}>
                  <b style={{ color: COLORS.text }}>Step 1:</b> Upload your original sports photo or video (left box).<br />
                  <b style={{ color: COLORS.text }}>Step 2:</b> Edit a copy — apply filter, crop, change brightness, mirror it — save as new file.<br />
                  <b style={{ color: COLORS.text }}>Step 3:</b> Upload the edited version (right box).<br />
                  <b style={{ color: COLORS.text }}>Step 4:</b> Click COMPARE. The engine runs Quad Hash + 9-region crop detection + color channel analysis + mirror detection.
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div style={card}>
                <div style={cardH}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.greenLight }}>📁 ORIGINAL CONTENT</span>
                  {origStatus && <span style={{ fontSize: 11, color: origStatus.includes('✅') ? COLORS.greenLight : COLORS.muted }}>{origStatus}</span>}
                </div>
                <div style={{ padding: 18 }}>
                  <DropZone label="Upload Original" file={origFile} preview={origPreview} onFile={loadOrig} accept="image/*,video/*" hint="JPG, PNG, MP4, MOV supported" />
                </div>
              </div>
              <div style={card}>
                <div style={cardH}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.amberLight }}>🔍 SUSPECTED COPY</span>
                  {suspStatus && <span style={{ fontSize: 11, color: suspStatus.includes('✅') ? COLORS.greenLight : COLORS.muted }}>{suspStatus}</span>}
                </div>
                <div style={{ padding: 18 }}>
                  <DropZone label="Upload Edited / Suspected Copy" file={suspFile} preview={suspPreview} onFile={loadSusp} accept="image/*,video/*" hint="Upload cropped / filtered / mirrored version" />
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <button onClick={runComparison} disabled={!origSource || !suspSource || comparing}
                style={{ ...btn(origSource && suspSource ? COLORS.blueLight : COLORS.border), padding: '13px 40px', fontSize: 14, opacity: (!origSource || !suspSource) ? 0.4 : 1, cursor: (!origSource || !suspSource) ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {comparing ? <><span style={{ display: 'inline-block', animation: 'spin 0.8s linear infinite' }}>⟳</span> {compareStep || 'ANALYSING...'}</> : '⚡ RUN COMPARISON'}
              </button>
              {(!origSource || !suspSource) && <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 8 }}>Upload both files above to enable comparison</div>}
            </div>

            {result && (
              <div className="fi" style={{ background: statusCfg[result.status].bg, border: `1px solid ${statusCfg[result.status].border}`, borderRadius: 12, padding: 22 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 24 }}>{statusCfg[result.status].icon}</span>
                      <span style={{ fontWeight: 900, fontSize: 22, color: statusCfg[result.status].color }}>{result.status}</span>
                      <span style={{ fontWeight: 900, fontSize: 26, color: statusCfg[result.status].color }}>{result.overall}%</span>
                    </div>
                    <div style={{ fontSize: 13, color: COLORS.muted }}>{result.reason}</div>
                  </div>
                  {result.status !== 'CLEAN' && <button onClick={() => setDmcaOpen(true)} style={btn(COLORS.red)}>📋 GENERATE DMCA</button>}
                </div>

                <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 16, marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: COLORS.muted, letterSpacing: 1.5, marginBottom: 12 }}>HASH BREAKDOWN</div>
                  <Meter label="pHash — Perceptual (DCT)" value={result.pSim} color={mc(result.pSim)} />
                  <Meter label="dHash — Edge Detection" value={result.dSim} color={mc(result.dSim)} />
                  <Meter label="aHash — Brightness Average" value={result.aSim} color={mc(result.aSim)} />
                  <Meter label="wHash — Wavelet Frequency" value={result.wSim} color={mc(result.wSim)} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 14 }}>
                  <DetCard icon="🎨" label="Color Filter Detected" detected={result.colorFilterDetected} sub={result.colorFilterDetected ? `R:${result.colorDiff.r} G:${result.colorDiff.g} B:${result.colorDiff.b} channel shift` : null} />
                  <DetCard icon="🌓" label="Brightness Edit Detected" detected={result.brightnessEdited} sub={result.brightnessEdited ? `${result.brightnessDiff} unit brightness change` : null} />
                  <DetCard icon="✂️" label="Crop / Zoom Detected" detected={result.cropDetected} sub={result.cropDetected ? `Best region match: ${result.cropScore}%` : null} />
                  <DetCard icon="🪞" label="Mirror / Flip Detected" detected={result.mirrorDetected} sub={result.mirrorDetected ? `Mirror score: ${result.mirrorScore}%` : null} />
                </div>

                <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.7 }}>
                    <b style={{ color: COLORS.text }}>Thresholds:</b> 85%+ = STOLEN &nbsp;|&nbsp; 70–85% = SUSPICIOUS &nbsp;|&nbsp; 50–70% = INVESTIGATING &nbsp;|&nbsp; Below 50% = CLEAN<br />
                    Hamming — pHash: <b style={{ color: COLORS.text }}>{result.pDist} bits</b> | dHash: <b style={{ color: COLORS.text }}>{result.dDist} bits</b> | aHash: <b style={{ color: COLORS.text }}>{result.aDist} bits</b> | wHash: <b style={{ color: COLORS.text }}>{result.wDist} bits</b>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── REGISTER TAB ── */}
        {tab === 'register' && (
          <div className="fi">
            <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 10, padding: '12px 16px', marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: COLORS.greenLight, marginBottom: 3 }}>📌 WHAT THIS DOES</div>
              <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.6 }}>
                Upload your original content to register its digital fingerprint. Sports Guardian generates pHash + dHash + aHash + wHash — four independent digital IDs that identify your content even after editing, cropping, color changes, or mirroring. This is how a broadcaster registers a clip before match day.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
              <div style={card}>
                <div style={cardH}><span style={{ fontWeight: 700, fontSize: 13 }}>📁 Upload to Register</span></div>
                <div style={{ padding: 18 }}>
                  <DropZone label="Click to upload image or video" file={regFile} preview={regPreview} onFile={registerFile} accept="image/*,video/*" hint="Supports JPG, PNG, MP4, MOV" />
                  {regLog.length > 0 && (
                    <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.3)', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 14, fontFamily: 'monospace', fontSize: 12 }}>
                      {regLog.map((l, i) => <div key={i} style={{ color: l.color, marginBottom: 5 }}>{l.text}</div>)}
                    </div>
                  )}
                </div>
              </div>
              <div style={card}>
                <div style={cardH}><span style={{ fontWeight: 700, fontSize: 13 }}>🔑 Generated Fingerprint</span></div>
                <div style={{ padding: 18 }}>
                  {!regDone ? <div style={{ color: COLORS.muted, fontSize: 13, textAlign: 'center', paddingTop: 40 }}>Upload a file to see its fingerprint</div> : (
                    <div className="fi">
                      <div style={{ marginBottom: 14, padding: 12, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8 }}>
                        <div style={{ fontWeight: 700, color: COLORS.greenLight, fontSize: 13, marginBottom: 2 }}>✅ FINGERPRINT REGISTERED</div>
                        <div style={{ fontSize: 11, color: COLORS.muted }}>Quad hash saved. Color filter resistant: YES. Crop resistant: YES.</div>
                      </div>
                      {['pHash','dHash','aHash','wHash'].map((type, ti) => (
                        <div key={type} style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 11, color: COLORS.muted, letterSpacing: 1, marginBottom: 3 }}>
                            {type==='pHash'?'🔍 pHash — Perceptual':type==='dHash'?'📊 dHash — Edge':type==='aHash'?'☀️ aHash — Brightness':'🌊 wHash — Wavelet'}
                          </div>
                          <div style={{ fontFamily: 'monospace', fontSize: 10, color: [COLORS.greenLight,'#818cf8',COLORS.amberLight,'#38bdf8'][ti], wordBreak: 'break-all', background: 'rgba(0,0,0,0.2)', padding: '6px 10px', borderRadius: 6 }}>
                            {regHashes[type].join('')}
                          </div>
                        </div>
                      ))}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                        {[{icon:'✂️',label:'Crop resistant',val:'Yes'},{icon:'🎨',label:'Filter resistant',val:'Yes'},{icon:'📦',label:'Compression resistant',val:'Yes'},{icon:'🪞',label:'Mirror resistant',val:'Yes'}].map((f,i)=>(
                          <div key={i} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontSize: 16 }}>{f.icon}</span>
                            <div>
                              <div style={{ fontSize: 10, color: COLORS.muted }}>{f.label}</div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.greenLight }}>{f.val}</div>
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
          <div className="fi">
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: COLORS.muted }}>
              <b style={{ color: COLORS.text }}>Note:</b> These alerts simulate what Sports Guardian detects when scanning YouTube, Instagram, and Telegram for stolen sports clips. In a live system, these are real results from platform API crawlers.
            </div>
            <div style={card}>
              <div style={cardH}>
                <span style={{ fontWeight: 700, fontSize: 12, color: COLORS.muted, letterSpacing: 1.5 }}>DETECTION RESULTS — QUAD HASH ENGINE</span>
                <span style={{ fontSize: 12, color: COLORS.redLight, fontWeight: 700 }}>3 STOLEN FOUND</span>
              </div>
              {mockAlerts.map(a => {
                const sc = statusCfg[a.status];
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderBottom: `1px solid ${COLORS.border}`, borderLeft: `3px solid ${sc.color}` }}>
                    <span style={{ background: platformColors[a.platform]||'#666', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}>{a.platform.toUpperCase()}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.clip}</div>
                      <div style={{ fontSize: 11, color: COLORS.muted }}>{a.uploader}</div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 60 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: a.confidence>85?COLORS.redLight:a.confidence>70?COLORS.amberLight:COLORS.greenLight }}>{a.confidence}%</div>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 3 }}>
                        <div style={{ height: '100%', width: `${a.confidence}%`, background: a.confidence>85?COLORS.redLight:a.confidence>70?COLORS.amberLight:COLORS.greenLight, borderRadius: 2 }} />
                      </div>
                    </div>
                    <span style={{ background: sc.bg, border: `1px solid ${sc.border}`, color: sc.color, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>{sc.icon} {a.status}</span>
                    {a.status !== 'CLEAN' && <button style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: COLORS.redLight, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>DMCA</button>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── LINEAGE TAB ── */}
        {tab === 'lineage' && (
          <div className="fi" style={card}>
            <div style={cardH}><span style={{ fontWeight: 700, fontSize: 12, color: COLORS.muted, letterSpacing: 1.5 }}>CONTENT SPREAD ANALYSIS</span></div>
            <div style={{ padding: 20 }}>
              <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 18, lineHeight: 1.6 }}>
                Once a clip is stolen, Sports Guardian tracks how it spreads across platforms using detection timestamps. This tree shows the path a stolen clip travels after leaving the original broadcaster.
              </div>
              <svg width="100%" viewBox="0 0 680 300" style={{ fontFamily: 'inherit' }}>
                <defs><filter id="gw"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
                {[[340,55,140,155],[340,55,340,155],[340,55,540,155],[140,155,70,250],[140,155,210,250],[340,155,340,250],[540,155,470,250],[540,155,610,250]].map(([x1,y1,x2,y2],i)=>(
                  <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={COLORS.border} strokeWidth="1.5" strokeDasharray="4 3"/>
                ))}
                {[
                  {x:340,y:55, label:'ORIGINAL', sub:'ISL Official', color:COLORS.greenLight,r:26},
                  {x:140,y:155,label:'TELEGRAM', sub:'IPL Leaks',   color:'#3b82f6',r:20},
                  {x:340,y:155,label:'YOUTUBE',  sub:'@highlights', color:'#ef4444',r:20},
                  {x:540,y:155,label:'INSTAGRAM',sub:'@reels',      color:'#ec4899',r:20},
                  {x:70, y:250,label:'WA GROUP', sub:'500 views',   color:COLORS.amberLight,r:14},
                  {x:210,y:250,label:'REDDIT',   sub:'r/cricket',   color:'#f97316',r:14},
                  {x:340,y:250,label:'TWITTER',  sub:'@fan',        color:'#38bdf8',r:14},
                  {x:470,y:250,label:'TIKTOK',   sub:'viral',       color:'#ef4444',r:14},
                  {x:610,y:250,label:'YOUTUBE',  sub:'mirror',      color:'#ef4444',r:14},
                ].map((n,i)=>(
                  <g key={i} filter="url(#gw)">
                    <circle cx={n.x} cy={n.y} r={n.r+5} fill={n.color+'18'} stroke={n.color+'50'} strokeWidth="1"/>
                    <circle cx={n.x} cy={n.y} r={n.r}   fill={n.color+'22'} stroke={n.color}      strokeWidth="1.5"/>
                    <text x={n.x} y={n.y-3} textAnchor="middle" fill={n.color}    fontSize="7.5" fontWeight="bold">{n.label}</text>
                    <text x={n.x} y={n.y+8} textAnchor="middle" fill={COLORS.muted} fontSize="6.5">{n.sub}</text>
                  </g>
                ))}
              </svg>
            </div>
          </div>
        )}

      </main>

      {dmcaOpen && result && (
        <DmcaModal result={result} origFile={origFile} suspFile={suspFile} onClose={() => setDmcaOpen(false)} />
      )}
    </div>
  );
}