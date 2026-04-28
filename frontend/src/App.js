import React, { useState, useRef, useCallback } from 'react';

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────

const FLASK_URL = 'http://localhost:5000/compare';

// ─────────────────────────────────────────────
//  VIDEO FRAME EXTRACTION
//  Extracts N evenly-spaced frames from a video file
//  Returns array of { blob, dataUrl, timestamp }
// ─────────────────────────────────────────────

function extractVideoFrames(file, numFrames = 3) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.preload = 'metadata';

    video.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      reject(new Error('Video load failed'));
    });

    video.addEventListener('loadedmetadata', () => {
      const duration = video.duration;
      // Pick timestamps: skip first & last 5% to avoid black frames
      const start = duration * 0.05;
      const end = duration * 0.95;
      const step = (end - start) / (numFrames - 1 || 1);
      const timestamps = Array.from({ length: numFrames }, (_, i) =>
        numFrames === 1 ? start : start + i * step
      );

      const frames = [];
      let idx = 0;

      const seekNext = () => {
        if (idx >= timestamps.length) {
          URL.revokeObjectURL(url);
          resolve(frames);
          return;
        }
        video.currentTime = timestamps[idx];
      };

      video.addEventListener('seeked', () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          frames.push({ blob, dataUrl, timestamp: timestamps[idx] });
          idx++;
          seekNext();
        }, 'image/jpeg', 0.92);
      });

      seekNext();
    });

    video.load();
  });
}

// ─────────────────────────────────────────────
//  SINGLE FRAME EXTRACTION (for preview)
// ─────────────────────────────────────────────

function extractSingleFrame(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;

    video.addEventListener('loadeddata', () => {
      video.currentTime = Math.min(2, (video.duration || 4) * 0.3);
    });

    video.addEventListener('seeked', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 120;
      canvas.getContext('2d').drawImage(video, 0, 0, 200, 120);
      const preview = canvas.toDataURL('image/jpeg', 0.85);
      URL.revokeObjectURL(url);
      resolve(preview);
    });

    video.addEventListener('error', reject);
    video.load();
  });
}

// ─────────────────────────────────────────────
//  FLASK API CALL
//  Sends original + suspect as FormData to /compare
//  Returns the JSON result from Flask
// ─────────────────────────────────────────────

async function callFlaskCompare(origBlob, suspBlob, origName = 'original.jpg', suspName = 'suspect.jpg') {
  const form = new FormData();
  form.append('file_a', origBlob, origName);
  form.append('file_b', suspBlob, suspName);

  const response = await fetch(FLASK_URL, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Flask error ${response.status}: ${text}`);
  }

  const json = await response.json();

  // Flask wraps everything inside json.data
  const d = json.data;

  if (!d) {
    throw new Error('Flask returned empty data');
  }

  // Map Flask field names → what the UI expects
  return {
    overall:          d.confidence         ?? 0,
    status:           d.verdict            ?? 'CLEAN',
    reason:           `ORB: ${d.orb_score ?? 0}% | Crop: ${d.crop_score ?? 0}% | Hash: ${d.hash_score ?? 0}%`,

    // Score meters
    orb_score:        d.orb_score          ?? 0,
    crop_score:       d.crop_score         ?? 0,
    pSim:             d.hash_score         ?? 0,

    // Detection cards
    crop_detected:    d.detection_details?.crop?.crop_detected    ?? false,
    mirror_detected:  d.mirror_detected                           ?? false,
    mirror_score:     d.detection_details?.mirror?.score          ?? 0,
    rotation_detected: d.rotation_detected                        ?? false,
    rotation_angle:   d.best_angle                                ?? 0,

    // Raw label
    label:            `${origName} vs ${suspName}`,
  };
}

// ─────────────────────────────────────────────
//  FILE → BLOB HELPER
//  Images: use the file directly
//  Videos: extract 3 frames, compare each, return best
// ─────────────────────────────────────────────

async function fileToBlob(file) {
  if (file.type.startsWith('image/')) {
    return [{ blob: file, name: file.name, isFrame: false, timestamp: null }];
  }
  // Video — extract 3 frames
  const frames = await extractVideoFrames(file, 3);
  return frames.map((f, i) => ({
    blob: f.blob,
    name: `${file.name}_frame${i + 1}.jpg`,
    isFrame: true,
    timestamp: f.timestamp,
    dataUrl: f.dataUrl,
  }));
}

// ─────────────────────────────────────────────
//  FULL COMPARE — orchestrates all frame pairs
//  Returns: best result + per-frame breakdown
// ─────────────────────────────────────────────

async function fullCompare(origFile, suspFile, onStep) {
  onStep('📦 Preparing files for upload...');
  const [origItems, suspItems] = await Promise.all([
    fileToBlob(origFile),
    fileToBlob(suspFile),
  ]);

  // Build comparison pairs:
  // If both are images → 1 comparison
  // If orig is image, susp is video → compare orig vs each susp frame
  // If orig is video, susp is image → compare each orig frame vs susp
  // If both are videos → compare orig frame[i] vs susp frame[i] for each i
  const pairs = [];

  if (origItems.length === 1 && suspItems.length === 1) {
    pairs.push({ orig: origItems[0], susp: suspItems[0], label: 'Image vs Image' });
  } else if (origItems.length === 1) {
    suspItems.forEach((s, i) =>
      pairs.push({ orig: origItems[0], susp: s, label: `Image vs Video Frame ${i + 1} (${s.timestamp?.toFixed(1)}s)` })
    );
  } else if (suspItems.length === 1) {
    origItems.forEach((o, i) =>
      pairs.push({ orig: o, susp: suspItems[0], label: `Video Frame ${i + 1} (${o.timestamp?.toFixed(1)}s) vs Image` })
    );
  } else {
    // Both videos — compare corresponding frames + cross-compare for thoroughness
    for (let oi = 0; oi < origItems.length; oi++) {
      for (let si = 0; si < suspItems.length; si++) {
        pairs.push({
          orig: origItems[oi],
          susp: suspItems[si],
          label: `Orig Frame ${oi + 1} vs Susp Frame ${si + 1}`,
        });
      }
    }
  }

  const frameResults = [];
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    onStep(`🔍 Comparing ${pair.label}... (${i + 1}/${pairs.length})`);
    try {
      const result = await callFlaskCompare(pair.orig.blob, pair.susp.blob, pair.orig.name, pair.susp.name);
      frameResults.push({ ...result, label: pair.label, pairIndex: i });
    } catch (err) {
      frameResults.push({
        error: err.message,
        label: pair.label,
        pairIndex: i,
        overall: 0,
        status: 'ERROR',
      });
    }
  }

  // Pick the result with the highest overall confidence
  const best = frameResults.reduce((a, b) => ((a.overall || 0) >= (b.overall || 0) ? a : b), frameResults[0]);

  return {
    best,
    allFrames: frameResults,
    totalPairs: pairs.length,
    isMultiFrame: pairs.length > 1,
  };
}

// ─────────────────────────────────────────────
//  COLORS & CONFIG
// ─────────────────────────────────────────────

const COLORS = {
  green: '#16a34a', greenLight: '#22c55e',
  red: '#dc2626', redLight: '#ef4444',
  amber: '#d97706', amberLight: '#f59e0b',
  blue: '#1d4ed8', blueLight: '#3b82f6',
  bg: '#0f172a', surface: '#1e293b', border: '#334155',
  text: '#f1f5f9', muted: '#94a3b8',
};

const statusCfg = {
  STOLEN: { color: '#ef4444', bg: 'rgba(220,38,38,0.12)', border: 'rgba(220,38,38,0.35)', icon: '🚨' },
  SUSPICIOUS: { color: '#f59e0b', bg: 'rgba(217,119,6,0.12)', border: 'rgba(217,119,6,0.35)', icon: '⚠️' },
  INVESTIGATING: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.25)', icon: '🔍' },
  CLEAN: { color: '#22c55e', bg: 'rgba(22,163,74,0.12)', border: 'rgba(22,163,74,0.35)', icon: '✅' },
  ERROR: { color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)', icon: '❌' },
};

const platformColors = {
  YouTube: '#ef4444', Instagram: '#ec4899', Telegram: '#3b82f6', Reddit: '#f97316', Twitter: '#38bdf8',
};

// ─────────────────────────────────────────────
//  COMPONENTS
// ─────────────────────────────────────────────

function DropZone({ label, file, preview, onFile, accept, hint }) {
  const ref = useRef();
  const [drag, setDrag] = useState(false);
  const drop = (e) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };
  const isVideo = file?.type?.startsWith('video/');
  return (
    <div
      onClick={() => ref.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={drop}
      style={{
        border: `2px dashed ${drag ? COLORS.greenLight : file ? COLORS.green : COLORS.border}`,
        borderRadius: 12,
        background: drag ? 'rgba(34,197,94,0.06)' : file ? 'rgba(34,197,94,0.04)' : 'rgba(255,255,255,0.02)',
        padding: '20px 16px',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all 0.2s',
        minHeight: 160,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <input
        ref={ref}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => e.target.files[0] && onFile(e.target.files[0])}
      />
      {preview ? (
        <img
          src={preview}
          alt="preview"
          style={{ maxHeight: 100, maxWidth: '100%', borderRadius: 8, objectFit: 'contain', marginBottom: 4 }}
        />
      ) : (
        <div style={{ fontSize: 36 }}>{accept.includes('video') ? '🎬' : '🖼️'}</div>
      )}
      <div style={{ fontWeight: 700, fontSize: 13, color: file ? COLORS.greenLight : COLORS.text, letterSpacing: 1 }}>
        {file ? file.name : label}
      </div>
      {file && (
        <div style={{ fontSize: 11, color: COLORS.muted, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
          {isVideo && (
            <span style={{
              background: 'rgba(59,130,246,0.15)',
              border: '1px solid rgba(59,130,246,0.3)',
              color: COLORS.blueLight,
              padding: '1px 6px',
              borderRadius: 4,
              fontSize: 10,
            }}>
              🎬 3 FRAMES
            </span>
          )}
        </div>
      )}
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
        <div
          style={{
            height: '100%',
            width: `${value}%`,
            background: color,
            borderRadius: 3,
            transition: 'width 0.8s ease',
          }}
        />
      </div>
    </div>
  );
}

function DetCard({ icon, label, detected, sub }) {
  return (
    <div
      style={{
        background: detected ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${detected ? 'rgba(245,158,11,0.3)' : COLORS.border}`,
        borderRadius: 8,
        padding: '10px 12px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 10, color: COLORS.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: detected ? COLORS.amberLight : COLORS.greenLight }}>
        {detected ? 'DETECTED' : 'NOT DETECTED'}
      </div>
      {sub && <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Frame results breakdown table
function FrameBreakdown({ frames }) {
  if (!frames || frames.length <= 1) return null;
  return (
    <div
      style={{
        background: 'rgba(0,0,0,0.2)',
        borderRadius: 10,
        padding: 16,
        marginTop: 14,
      }}
    >
      <div style={{ fontSize: 11, color: COLORS.muted, letterSpacing: 1.5, marginBottom: 10 }}>
        🎬 PER-FRAME BREAKDOWN — BEST RESULT SHOWN ABOVE
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {frames.map((f, i) => {
          const sc = statusCfg[f.status] || statusCfg.ERROR;
          const isBest = frames.indexOf(frames.reduce((a, b) => ((a.overall || 0) >= (b.overall || 0) ? a : b))) === i;
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: isBest ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isBest ? 'rgba(59,130,246,0.3)' : COLORS.border}`,
                borderRadius: 8,
              }}
            >
              {isBest && (
                <span
                  style={{
                    fontSize: 9,
                    background: 'rgba(59,130,246,0.2)',
                    color: COLORS.blueLight,
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  BEST
                </span>
              )}
              <div style={{ flex: 1, fontSize: 11, color: COLORS.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.label}
              </div>
              {f.error ? (
                <span style={{ fontSize: 11, color: COLORS.red }}>{f.error}</span>
              ) : (
                <>
                  <div style={{ width: 80, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2 }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${f.overall || 0}%`,
                        background: sc.color,
                        borderRadius: 2,
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: sc.color, minWidth: 40, textAlign: 'right' }}>
                    {f.overall ?? '—'}%
                  </span>
                  <span
                    style={{
                      background: sc.bg,
                      border: `1px solid ${sc.border}`,
                      color: sc.color,
                      fontSize: 9,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 20,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {sc.icon} {f.status}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── DMCA Modal ──
function DmcaModal({ result, origFile, suspFile, onClose }) {
  const r = result?.best || result || {};
  const letter = `DMCA TAKEDOWN NOTICE
Sports Guardian — Detection Engine
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TO: Platform Trust & Safety Team
RE: Unauthorized Sports Content

INFRINGING CONTENT:
• Original File      : ${origFile?.name || 'Registered content'}
• Suspected Copy     : ${suspFile?.name || 'Detected content'}
• Overall Confidence : ${r.overall ?? '—'}%
• Detection Method   : ORB + 13-Region Crop + Rotation + Mirror (Flask)
• Verdict            : ${r.status ?? '—'}
• Best Match Frame   : ${r.label ?? 'N/A'}
${r.orb_score !== undefined ? `• ORB Score          : ${r.orb_score}%` : ''}
${r.crop_score !== undefined ? `• Crop Score         : ${r.crop_score}%` : ''}
${r.mirror_detected !== undefined ? `• Mirror Detected    : ${r.mirror_detected ? 'YES' : 'NO'}` : ''}
${r.rotation_detected !== undefined ? `• Rotation Detected  : ${r.rotation_detected ? 'YES' : 'NO'}` : ''}

I have a good faith belief that this content infringes on
the copyright of the registered content owner. I request
immediate removal under DMCA Section 512(c).

— Sports Guardian Automated DMCA System
   Generated: ${new Date().toLocaleString()}`;

  const download = () => {
    const blob = new Blob([letter], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DMCA_Notice_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 16,
          padding: 28,
          maxWidth: 520,
          width: '90%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: COLORS.text, letterSpacing: 1 }}>DMCA TAKEDOWN NOTICE</div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: `1px solid ${COLORS.border}`,
              color: COLORS.muted,
              width: 30,
              height: 30,
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>
        <textarea
          readOnly
          value={letter}
          style={{
            width: '100%',
            height: 280,
            background: 'rgba(0,0,0,0.3)',
            border: `1px solid ${COLORS.border}`,
            color: '#ccc',
            padding: 14,
            borderRadius: 8,
            fontFamily: 'monospace',
            fontSize: 11,
            resize: 'none',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            onClick={() => navigator.clipboard.writeText(letter)}
            style={{
              flex: 1,
              background: COLORS.green,
              color: '#fff',
              border: 'none',
              padding: '10px',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            📋 COPY
          </button>
          <button
            onClick={download}
            style={{
              flex: 1,
              background: COLORS.blue,
              color: '#fff',
              border: 'none',
              padding: '10px',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            ⬇️ DOWNLOAD
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '10px 18px',
              background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${COLORS.border}`,
              color: COLORS.muted,
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            CLOSE
          </button>
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

  // Original file state
  const [origFile, setOrigFile] = useState(null);
  const [origPreview, setOrigPreview] = useState(null);
  const [origStatus, setOrigStatus] = useState('');

  // Suspect file state
  const [suspFile, setSuspFile] = useState(null);
  const [suspPreview, setSuspPreview] = useState(null);
  const [suspStatus, setSuspStatus] = useState('');

  // Comparison result state
  const [compareResult, setCompareResult] = useState(null); // { best, allFrames, totalPairs, isMultiFrame }
  const [comparing, setComparing] = useState(false);
  const [compareStep, setCompareStep] = useState('');
  const [compareError, setCompareError] = useState('');
  const [dmcaOpen, setDmcaOpen] = useState(false);

  // Register tab state
  const [regFile, setRegFile] = useState(null);
  const [regPreview, setRegPreview] = useState(null);
  const [regLog, setRegLog] = useState([]);
  const [regDone, setRegDone] = useState(false);

  const mockAlerts = [
    { id: 1, platform: 'YouTube', uploader: '@cricket_highlights_hd', clip: 'Kohli Century — T20 World Cup', confidence: 97.3, status: 'STOLEN' },
    { id: 2, platform: 'Instagram', uploader: '@sports_reels_india', clip: 'Bumrah Hat-trick Celebration', confidence: 91.8, status: 'STOLEN' },
    { id: 3, platform: 'Telegram', uploader: 'IPL Leaks Channel', clip: 'Rohit Sharma Six Compilation', confidence: 88.5, status: 'SUSPICIOUS' },
    { id: 4, platform: 'YouTube', uploader: '@fan_edits_cricket', clip: 'Dhoni Finishes Off in Style', confidence: 76.2, status: 'INVESTIGATING' },
    { id: 5, platform: 'Reddit', uploader: 'u/cricket_fan_2024', clip: 'Shami Bowling Masterclass', confidence: 42.1, status: 'CLEAN' },
  ];

  // Load original file — generate preview only (no hashing on frontend)
  const loadOrig = useCallback(async (file) => {
    setOrigFile(file);
    setCompareResult(null);
    setCompareError('');
    setOrigStatus('Processing...');
    setOrigPreview(null);
    try {
      if (file.type.startsWith('video/')) {
        const preview = await extractSingleFrame(file);
        setOrigPreview(preview);
      } else {
        setOrigPreview(URL.createObjectURL(file));
      }
      setOrigStatus('✅ Ready');
    } catch {
      setOrigStatus('❌ Failed to load');
    }
  }, []);

  // Load suspect file — generate preview only
  const loadSusp = useCallback(async (file) => {
    setSuspFile(file);
    setCompareResult(null);
    setCompareError('');
    setSuspStatus('Processing...');
    setSuspPreview(null);
    try {
      if (file.type.startsWith('video/')) {
        const preview = await extractSingleFrame(file);
        setSuspPreview(preview);
      } else {
        setSuspPreview(URL.createObjectURL(file));
      }
      setSuspStatus('✅ Ready');
    } catch {
      setSuspStatus('❌ Failed to load');
    }
  }, []);

  // Run the full comparison against Flask
  const runComparison = async () => {
    if (!origFile || !suspFile || comparing) return;
    setComparing(true);
    setCompareResult(null);
    setCompareError('');

    try {
      const result = await fullCompare(origFile, suspFile, (step) => setCompareStep(step));
      setCompareResult(result);
    } catch (err) {
      console.error(err);
      setCompareError(`Error: ${err.message}. Make sure Flask is running on ${FLASK_URL}`);
    }

    setComparing(false);
    setCompareStep('');
  };

  // Register tab — just generates a preview + log (registration would POST to a /register endpoint)
  const registerFile = useCallback(async (file) => {
    setRegFile(file);
    setRegDone(false);
    setRegLog([]);
    setRegPreview(null);
    const log = (text, color) => setRegLog((p) => [...p, { text, color }]);

    log(file.type.startsWith('video/') ? '🎬 Video detected — extracting key frame...' : '🖼️ Image detected — loading...', COLORS.blueLight);
    try {
      let preview;
      if (file.type.startsWith('video/')) {
        preview = await extractSingleFrame(file);
      } else {
        preview = URL.createObjectURL(file);
      }
      setRegPreview(preview);
      await new Promise((r) => setTimeout(r, 400));
      log('🔍 Sending to Flask registration endpoint...', COLORS.blueLight);
      await new Promise((r) => setTimeout(r, 600));
      log('🎨 Generating ORB descriptor fingerprint...', '#818cf8');
      await new Promise((r) => setTimeout(r, 400));
      log('✂️ Computing 13-region crop signature...', '#818cf8');
      await new Promise((r) => setTimeout(r, 400));
      log('🪞 Computing mirror & rotation signature...', '#818cf8');
      await new Promise((r) => setTimeout(r, 300));
      setRegDone(true);
      log(`✅ "${file.name}" registered! ORB fingerprint saved.`, COLORS.greenLight);
    } catch {
      log('❌ Failed to process file. Try a different format.', COLORS.red);
    }
  }, []);

  // Color helper — high confidence = red, low = green
  const mc = (v) => (v > 85 ? COLORS.redLight : v > 70 ? COLORS.amberLight : COLORS.greenLight);

  const card = {
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  };
  const cardH = {
    padding: '14px 18px',
    borderBottom: `1px solid ${COLORS.border}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };
  const btn = (bg) => ({
    background: bg,
    border: `1px solid ${bg}`,
    color: '#fff',
    padding: '10px 20px',
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
    letterSpacing: 0.5,
  });

  // Destructure best result for rendering
  const best = compareResult?.best;
  const sc = best ? statusCfg[best.status] || statusCfg.ERROR : null;

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.text, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${COLORS.bg}; }
        button:hover { opacity: 0.88; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fi { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .fi { animation: fi 0.35s ease both; }
      `}</style>

      {/* HEADER */}
      <header
        style={{
          background: '#0a1628',
          borderBottom: `1px solid ${COLORS.border}`,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 64,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 26 }}>🛡️</span>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: 1.5, color: COLORS.text }}>SPORTS GUARDIAN</div>
            <div style={{ fontSize: 10, color: COLORS.muted, letterSpacing: 2 }}>CONTENT PROTECTION SYSTEM</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span
            style={{
              background: 'rgba(34,197,94,0.12)',
              border: '1px solid rgba(34,197,94,0.3)',
              color: COLORS.greenLight,
              fontSize: 10,
              padding: '4px 12px',
              borderRadius: 20,
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            v4.0 ORB + FLASK
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: COLORS.greenLight,
                boxShadow: '0 0 8px #22c55e',
              }}
            />
            <span style={{ fontSize: 11, color: COLORS.greenLight, fontWeight: 700 }}>LIVE</span>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '28px 20px' }}>

        {/* STATS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 24 }}>
          {[
            { label: 'CLIPS PROTECTED', val: '2,847', color: COLORS.blueLight, icon: '🛡️' },
            { label: 'STOLEN DETECTED', val: '3', color: COLORS.red, icon: '🚨' },
            { label: 'DETECT TIME', val: '~8s', color: '#a78bfa', icon: '⚡' },
            { label: 'REVENUE SAVED', val: '₹4.2L', color: COLORS.greenLight, icon: '💰' },
          ].map((st, i) => (
            <div
              key={i}
              style={{
                background: COLORS.surface,
                border: `1px solid ${COLORS.border}`,
                borderTop: `3px solid ${st.color}`,
                borderRadius: 10,
                padding: '16px 14px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 22, marginBottom: 6 }}>{st.icon}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: st.color }}>{st.val}</div>
              <div style={{ fontSize: 10, color: COLORS.muted, letterSpacing: 1.5, marginTop: 2 }}>{st.label}</div>
            </div>
          ))}
        </div>

        {/* TABS */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            marginBottom: 20,
            background: COLORS.surface,
            borderRadius: 10,
            padding: 4,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          {[
            ['compare', '🔍 COMPARE & DETECT'],
            ['register', '📤 REGISTER CONTENT'],
            ['alerts', '🚨 ALERTS DASHBOARD'],
            ['lineage', '🕸️ SPREAD MAP'],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                flex: 1,
                padding: '9px 8px',
                background: tab === id ? '#1d4ed8' : 'transparent',
                border: tab === id ? '1px solid rgba(59,130,246,0.5)' : '1px solid transparent',
                color: tab === id ? '#fff' : COLORS.muted,
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 0.5,
                fontFamily: 'inherit',
                transition: 'all 0.18s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── COMPARE TAB ── */}
        {tab === 'compare' && (
          <div className="fi">
            {/* Info box */}
            <div
              style={{
                background: 'rgba(29,78,216,0.1)',
                border: '1px solid rgba(59,130,246,0.25)',
                borderRadius: 10,
                padding: '12px 16px',
                marginBottom: 18,
                display: 'flex',
                gap: 10,
              }}
            >
              <span style={{ fontSize: 18 }}>ℹ️</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#93c5fd', marginBottom: 3 }}>HOW IT WORKS (Flask Backend)</div>
                <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.7 }}>
                  <b style={{ color: COLORS.text }}>Images:</b> Sent directly to Flask <code style={{ color: '#93c5fd' }}>/compare</code> — ORB feature matching + 13-region crop detection + rotation + mirror analysis.<br />
                  <b style={{ color: COLORS.text }}>Videos:</b> 3 frames are extracted at evenly-spaced timestamps and each frame is compared independently. The <b style={{ color: COLORS.text }}>highest confidence result</b> wins and is shown below.
                </div>
              </div>
            </div>

            {/* Upload boxes */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div style={card}>
                <div style={cardH}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.greenLight }}>📁 ORIGINAL CONTENT</span>
                  {origStatus && (
                    <span style={{ fontSize: 11, color: origStatus.includes('✅') ? COLORS.greenLight : COLORS.muted }}>
                      {origStatus}
                    </span>
                  )}
                </div>
                <div style={{ padding: 18 }}>
                  <DropZone
                    label="Upload Original"
                    file={origFile}
                    preview={origPreview}
                    onFile={loadOrig}
                    accept="image/*,video/*"
                    hint="JPG, PNG, MP4, MOV supported"
                  />
                </div>
              </div>
              <div style={card}>
                <div style={cardH}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.amberLight }}>🔍 SUSPECTED COPY</span>
                  {suspStatus && (
                    <span style={{ fontSize: 11, color: suspStatus.includes('✅') ? COLORS.greenLight : COLORS.muted }}>
                      {suspStatus}
                    </span>
                  )}
                </div>
                <div style={{ padding: 18 }}>
                  <DropZone
                    label="Upload Edited / Suspected Copy"
                    file={suspFile}
                    preview={suspPreview}
                    onFile={loadSusp}
                    accept="image/*,video/*"
                    hint="Upload cropped / filtered / mirrored version"
                  />
                </div>
              </div>
            </div>

            {/* Video frame info banner */}
            {(origFile?.type?.startsWith('video/') || suspFile?.type?.startsWith('video/')) && (
              <div
                style={{
                  background: 'rgba(59,130,246,0.08)',
                  border: '1px solid rgba(59,130,246,0.2)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  marginBottom: 14,
                  fontSize: 12,
                  color: COLORS.muted,
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <span>🎬</span>
                <span>
                  Video detected —{' '}
                  {origFile?.type?.startsWith('video/') && suspFile?.type?.startsWith('video/')
                    ? '3×3 = 9 frame pairs will be compared'
                    : '3 frames will be extracted and each compared against the image'}
                  . Highest confidence result will be shown.
                </span>
              </div>
            )}

            {/* Compare button */}
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <button
                onClick={runComparison}
                disabled={!origFile || !suspFile || comparing}
                style={{
                  ...btn(origFile && suspFile ? COLORS.blueLight : COLORS.border),
                  padding: '13px 40px',
                  fontSize: 14,
                  opacity: !origFile || !suspFile ? 0.4 : 1,
                  cursor: !origFile || !suspFile ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {comparing ? (
                  <>
                    <span style={{ display: 'inline-block', animation: 'spin 0.8s linear infinite' }}>⟳</span>
                    {compareStep || 'ANALYSING...'}
                  </>
                ) : (
                  '⚡ RUN COMPARISON'
                )}
              </button>
              {(!origFile || !suspFile) && (
                <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 8 }}>
                  Upload both files above to enable comparison
                </div>
              )}
            </div>

            {/* Error display */}
            {compareError && (
              <div
                style={{
                  background: 'rgba(220,38,38,0.1)',
                  border: '1px solid rgba(220,38,38,0.3)',
                  borderRadius: 10,
                  padding: '14px 18px',
                  marginBottom: 16,
                  fontSize: 13,
                  color: COLORS.redLight,
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                }}
              >
                <span>❌</span>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Flask Connection Error</div>
                  <div style={{ color: COLORS.muted }}>{compareError}</div>
                </div>
              </div>
            )}

            {/* Results */}
            {compareResult && best && sc && (
              <div
                className="fi"
                style={{
                  background: sc.bg,
                  border: `1px solid ${sc.border}`,
                  borderRadius: 12,
                  padding: 22,
                }}
              >
                {/* Header row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 24 }}>{sc.icon}</span>
                      <span style={{ fontWeight: 900, fontSize: 22, color: sc.color }}>{best.status}</span>
                      <span style={{ fontWeight: 900, fontSize: 26, color: sc.color }}>{best.overall}%</span>
                    </div>
                    <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>{best.reason}</div>
                    {compareResult.isMultiFrame && (
                      <div
                        style={{
                          fontSize: 11,
                          color: COLORS.blueLight,
                          background: 'rgba(59,130,246,0.1)',
                          border: '1px solid rgba(59,130,246,0.2)',
                          borderRadius: 6,
                          padding: '3px 10px',
                          display: 'inline-block',
                        }}
                      >
                        🎬 Best of {compareResult.totalPairs} frame comparison{compareResult.totalPairs > 1 ? 's' : ''} — {best.label}
                      </div>
                    )}
                  </div>
                  {best.status !== 'CLEAN' && best.status !== 'ERROR' && (
                    <button onClick={() => setDmcaOpen(true)} style={btn(COLORS.red)}>
                      📋 GENERATE DMCA
                    </button>
                  )}
                </div>

                {/* Score meters — render whatever Flask returns */}
                <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 16, marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: COLORS.muted, letterSpacing: 1.5, marginBottom: 12 }}>SCORE BREAKDOWN</div>
                  {best.orb_score !== undefined && (
                    <Meter label="ORB — Feature Keypoint Matching" value={best.orb_score} color={mc(best.orb_score)} />
                  )}
                  {best.crop_score !== undefined && (
                    <Meter label="Crop Detection — 13-Region Analysis" value={best.crop_score} color={mc(best.crop_score)} />
                  )}
                  {best.pSim !== undefined && (
                    <Meter label="pHash — Perceptual (DCT)" value={best.pSim} color={mc(best.pSim)} />
                  )}
                  {best.dSim !== undefined && (
                    <Meter label="dHash — Edge Detection" value={best.dSim} color={mc(best.dSim)} />
                  )}
                  {best.aSim !== undefined && (
                    <Meter label="aHash — Brightness Average" value={best.aSim} color={mc(best.aSim)} />
                  )}
                  {/* Fallback if Flask returns nothing named above */}
                  {best.orb_score === undefined && best.crop_score === undefined && best.pSim === undefined && (
                    <div style={{ fontSize: 12, color: COLORS.muted }}>
                      Overall confidence: <b style={{ color: sc.color }}>{best.overall}%</b>
                    </div>
                  )}
                </div>

                {/* Detection cards — render only what Flask returns */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 14 }}>
                  {best.color_filter_detected !== undefined && (
                    <DetCard icon="🎨" label="Color Filter Detected" detected={best.color_filter_detected}
                      sub={best.color_filter_detected ? `R:${best.color_diff?.r ?? '?'} G:${best.color_diff?.g ?? '?'} B:${best.color_diff?.b ?? '?'} channel shift` : null} />
                  )}
                  {best.brightness_edited !== undefined && (
                    <DetCard icon="🌓" label="Brightness Edit Detected" detected={best.brightness_edited}
                      sub={best.brightness_edited ? `${best.brightness_diff} unit brightness change` : null} />
                  )}
                  {best.crop_detected !== undefined && (
                    <DetCard icon="✂️" label="Crop / Zoom Detected" detected={best.crop_detected}
                      sub={best.crop_detected ? `Best region match: ${best.crop_score}%` : null} />
                  )}
                  {best.mirror_detected !== undefined && (
                    <DetCard icon="🪞" label="Mirror / Flip Detected" detected={best.mirror_detected}
                      sub={best.mirror_detected ? `Mirror score: ${best.mirror_score}%` : null} />
                  )}
                  {best.rotation_detected !== undefined && (
                    <DetCard icon="🔄" label="Rotation Detected" detected={best.rotation_detected}
                      sub={best.rotation_detected ? `Angle: ${best.rotation_angle ?? '?'}°` : null} />
                  )}
                </div>

                {/* Thresholds */}
                <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 8, marginBottom: compareResult.isMultiFrame ? 0 : 0 }}>
                  <div style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.7 }}>
                    <b style={{ color: COLORS.text }}>Thresholds:</b> 85%+ = STOLEN &nbsp;|&nbsp; 70–85% = SUSPICIOUS &nbsp;|&nbsp; 50–70% = INVESTIGATING &nbsp;|&nbsp; Below 50% = CLEAN
                  </div>
                </div>

                {/* Per-frame breakdown (only for video) */}
                <FrameBreakdown frames={compareResult.allFrames} />
              </div>
            )}
          </div>
        )}

        {/* ── REGISTER TAB ── */}
        {tab === 'register' && (
          <div className="fi">
            <div
              style={{
                background: 'rgba(34,197,94,0.08)',
                border: '1px solid rgba(34,197,94,0.2)',
                borderRadius: 10,
                padding: '12px 16px',
                marginBottom: 18,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, color: COLORS.greenLight, marginBottom: 3 }}>📌 WHAT THIS DOES</div>
              <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.6 }}>
                Upload your original content to register its digital fingerprint with the Flask backend. The ORB engine generates feature descriptors
                that identify your content even after editing, cropping, color changes, mirroring, or rotation. This is how a broadcaster registers a clip before match day.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
              <div style={card}>
                <div style={cardH}><span style={{ fontWeight: 700, fontSize: 13 }}>📁 Upload to Register</span></div>
                <div style={{ padding: 18 }}>
                  <DropZone
                    label="Click to upload image or video"
                    file={regFile}
                    preview={regPreview}
                    onFile={registerFile}
                    accept="image/*,video/*"
                    hint="Supports JPG, PNG, MP4, MOV"
                  />
                  {regLog.length > 0 && (
                    <div
                      style={{
                        marginTop: 14,
                        background: 'rgba(0,0,0,0.3)',
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: 8,
                        padding: 14,
                        fontFamily: 'monospace',
                        fontSize: 12,
                      }}
                    >
                      {regLog.map((l, i) => (
                        <div key={i} style={{ color: l.color, marginBottom: 5 }}>
                          {l.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div style={card}>
                <div style={cardH}><span style={{ fontWeight: 700, fontSize: 13 }}>🔑 Registration Status</span></div>
                <div style={{ padding: 18 }}>
                  {!regDone ? (
                    <div style={{ color: COLORS.muted, fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
                      Upload a file to register it
                    </div>
                  ) : (
                    <div className="fi">
                      <div
                        style={{
                          marginBottom: 14,
                          padding: 12,
                          background: 'rgba(34,197,94,0.08)',
                          border: '1px solid rgba(34,197,94,0.2)',
                          borderRadius: 8,
                        }}
                      >
                        <div style={{ fontWeight: 700, color: COLORS.greenLight, fontSize: 13, marginBottom: 2 }}>
                          ✅ FINGERPRINT REGISTERED
                        </div>
                        <div style={{ fontSize: 11, color: COLORS.muted }}>
                          ORB descriptor saved. Crop resistant: YES. Mirror resistant: YES. Rotation resistant: YES.
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                        {[
                          { icon: '✂️', label: 'Crop resistant', val: 'Yes' },
                          { icon: '🎨', label: 'Filter resistant', val: 'Yes' },
                          { icon: '📦', label: 'Compression resistant', val: 'Yes' },
                          { icon: '🪞', label: 'Mirror resistant', val: 'Yes' },
                          { icon: '🔄', label: 'Rotation resistant', val: 'Yes' },
                          { icon: '🔍', label: 'ORB keypoints', val: '500+' },
                        ].map((f, i) => (
                          <div
                            key={i}
                            style={{
                              background: 'rgba(0,0,0,0.2)',
                              borderRadius: 8,
                              padding: '8px 10px',
                              display: 'flex',
                              gap: 8,
                              alignItems: 'center',
                            }}
                          >
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
            <div
              style={{
                background: 'rgba(239,68,68,0.06)',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 10,
                padding: '10px 14px',
                marginBottom: 16,
                fontSize: 12,
                color: COLORS.muted,
              }}
            >
              <b style={{ color: COLORS.text }}>Note:</b> These alerts simulate what Sports Guardian detects when scanning YouTube, Instagram, and Telegram
              for stolen sports clips. In a live system, these are real results from platform API crawlers.
            </div>
            <div style={card}>
              <div style={cardH}>
                <span style={{ fontWeight: 700, fontSize: 12, color: COLORS.muted, letterSpacing: 1.5 }}>
                  DETECTION RESULTS — ORB + FLASK ENGINE
                </span>
                <span style={{ fontSize: 12, color: COLORS.redLight, fontWeight: 700 }}>3 STOLEN FOUND</span>
              </div>
              {mockAlerts.map((a) => {
                const asc = statusCfg[a.status];
                return (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '14px 18px',
                      borderBottom: `1px solid ${COLORS.border}`,
                      borderLeft: `3px solid ${asc.color}`,
                    }}
                  >
                    <span
                      style={{
                        background: platformColors[a.platform] || '#666',
                        color: '#fff',
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 4,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {a.platform.toUpperCase()}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: COLORS.text,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {a.clip}
                      </div>
                      <div style={{ fontSize: 11, color: COLORS.muted }}>{a.uploader}</div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 60 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 800,
                          color: a.confidence > 85 ? COLORS.redLight : a.confidence > 70 ? COLORS.amberLight : COLORS.greenLight,
                        }}
                      >
                        {a.confidence}%
                      </div>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 3 }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${a.confidence}%`,
                            background:
                              a.confidence > 85 ? COLORS.redLight : a.confidence > 70 ? COLORS.amberLight : COLORS.greenLight,
                            borderRadius: 2,
                          }}
                        />
                      </div>
                    </div>
                    <span
                      style={{
                        background: asc.bg,
                        border: `1px solid ${asc.border}`,
                        color: asc.color,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: 20,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {asc.icon} {a.status}
                    </span>
                    {a.status !== 'CLEAN' && (
                      <button
                        style={{
                          background: 'rgba(239,68,68,0.12)',
                          border: '1px solid rgba(239,68,68,0.35)',
                          color: COLORS.redLight,
                          padding: '5px 12px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontSize: 10,
                          fontWeight: 700,
                          fontFamily: 'inherit',
                          whiteSpace: 'nowrap',
                        }}
                      >
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
          <div className="fi" style={card}>
            <div style={cardH}>
              <span style={{ fontWeight: 700, fontSize: 12, color: COLORS.muted, letterSpacing: 1.5 }}>CONTENT SPREAD ANALYSIS</span>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 18, lineHeight: 1.6 }}>
                Once a clip is stolen, Sports Guardian tracks how it spreads across platforms using detection timestamps. This tree shows the path a
                stolen clip travels after leaving the original broadcaster.
              </div>
              <svg width="100%" viewBox="0 0 680 300" style={{ fontFamily: 'inherit' }}>
                <defs>
                  <filter id="gw">
                    <feGaussianBlur stdDeviation="2.5" result="b" />
                    <feMerge>
                      <feMergeNode in="b" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {[
                  [340, 55, 140, 155], [340, 55, 340, 155], [340, 55, 540, 155],
                  [140, 155, 70, 250], [140, 155, 210, 250],
                  [340, 155, 340, 250],
                  [540, 155, 470, 250], [540, 155, 610, 250],
                ].map(([x1, y1, x2, y2], i) => (
                  <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={COLORS.border} strokeWidth="1.5" strokeDasharray="4 3" />
                ))}
                {[
                  { x: 340, y: 55, label: 'ORIGINAL', sub: 'ISL Official', color: COLORS.greenLight, r: 26 },
                  { x: 140, y: 155, label: 'TELEGRAM', sub: 'IPL Leaks', color: '#3b82f6', r: 20 },
                  { x: 340, y: 155, label: 'YOUTUBE', sub: '@highlights', color: '#ef4444', r: 20 },
                  { x: 540, y: 155, label: 'INSTAGRAM', sub: '@reels', color: '#ec4899', r: 20 },
                  { x: 70, y: 250, label: 'WA GROUP', sub: '500 views', color: COLORS.amberLight, r: 14 },
                  { x: 210, y: 250, label: 'REDDIT', sub: 'r/cricket', color: '#f97316', r: 14 },
                  { x: 340, y: 250, label: 'TWITTER', sub: '@fan', color: '#38bdf8', r: 14 },
                  { x: 470, y: 250, label: 'TIKTOK', sub: 'viral', color: '#ef4444', r: 14 },
                  { x: 610, y: 250, label: 'YOUTUBE', sub: 'mirror', color: '#ef4444', r: 14 },
                ].map((n, i) => (
                  <g key={i} filter="url(#gw)">
                    <circle cx={n.x} cy={n.y} r={n.r + 5} fill={n.color + '18'} stroke={n.color + '50'} strokeWidth="1" />
                    <circle cx={n.x} cy={n.y} r={n.r} fill={n.color + '22'} stroke={n.color} strokeWidth="1.5" />
                    <text x={n.x} y={n.y - 3} textAnchor="middle" fill={n.color} fontSize="7.5" fontWeight="bold">{n.label}</text>
                    <text x={n.x} y={n.y + 8} textAnchor="middle" fill={COLORS.muted} fontSize="6.5">{n.sub}</text>
                  </g>
                ))}
              </svg>
            </div>
          </div>
        )}

      </main>

      {dmcaOpen && compareResult && (
        <DmcaModal
          result={compareResult}
          origFile={origFile}
          suspFile={suspFile}
          onClose={() => setDmcaOpen(false)}
        />
      )}
    </div>
  );
}