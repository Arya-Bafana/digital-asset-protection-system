import { useState } from "react";

const API_URL = "http://localhost:5000";

const mockAlerts = [
  { id: 1, platform: "YouTube", uploader: "@CricketHighlights99", views: "2.4M", time: "8 sec ago", clip: "Kohli Six - Final Over", status: "stolen", confidence: 97 },
  { id: 2, platform: "Instagram", uploader: "@sports_reel_king", views: "890K", time: "23 sec ago", clip: "Kohli Six - Final Over", status: "stolen", confidence: 94 },
  { id: 3, platform: "Telegram", uploader: "IPL_Leaks_2026", views: "340K", time: "41 sec ago", clip: "Kohli Six - Final Over", status: "stolen", confidence: 91 },
  { id: 4, platform: "Reddit", uploader: "u/cricket_fan_india", views: "120K", time: "1 min ago", clip: "Match Highlights Reel", status: "investigating", confidence: 78 },
  { id: 5, platform: "YouTube", uploader: "@SportsZone", views: "55K", time: "2 min ago", clip: "Match Highlights Reel", status: "clean", confidence: 12 },
];

export default function App() {
  const [alerts] = useState(mockAlerts);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [dmcaModal, setDmcaModal] = useState(null);
  const [dmcaText, setDmcaText] = useState("");
  const [activeTab, setActiveTab] = useState("alerts");
  const [uploadStatus, setUploadStatus] = useState("");

  const runScan = () => {
    setScanning(true);
    setScanProgress(0);
    const interval = setInterval(() => {
      setScanProgress(p => {
        if (p >= 100) { clearInterval(interval); setScanning(false); return 100; }
        return p + 3;
      });
    }, 80);
  };

  const generateDMCA = (alert) => {
    setDmcaModal(alert);
    setDmcaText(`DMCA TAKEDOWN NOTICE\n\nTo: ${alert.platform} Trust & Safety Team\nDate: ${new Date().toDateString()}\nRe: Unauthorized use of copyrighted sports content\n\nDear ${alert.platform} Legal Team,\n\nWe are writing on behalf of Disney+ Hotstar (rights holder) to notify you of copyright infringement on your platform.\n\nINFRINGING CONTENT:\nPlatform: ${alert.platform}\nUploader: ${alert.uploader}\nContent: "${alert.clip}"\nViews at detection: ${alert.views}\nDetection confidence: ${alert.confidence}%\n\nOur AI watermark detection system has confirmed with ${alert.confidence}% confidence that this content is an unauthorized copy of our protected broadcast material.\n\nWe demand immediate removal under DMCA Section 512.\n\nRegards,\nSports Guardian Anti-Piracy System`);
  };

  const stats = [
    { label: "Clips protected", value: "3" },
    { label: "Stolen copies found", value: alerts.filter(a => a.status === "stolen").length.toString() },
    { label: "Detection time", value: "8 sec" },
    { label: "Revenue protected", value: "₹4.2L" },
  ];

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", background: "#f8f8f6", minHeight: "100vh" }}>
      <div style={{ background: "#1a1a2e", color: "white", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Sports Guardian</h1>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>AI-powered piracy detection — live dashboard</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80" }} />
          <span style={{ fontSize: 13, opacity: 0.8 }}>Monitoring active</span>
        </div>
      </div>

      <div style={{ padding: "20px 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
          {stats.map(s => (
            <div key={s.label} style={{ background: "white", borderRadius: 10, padding: "14px 16px", border: "0.5px solid #e0e0dc" }}>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: "#1a1a2e" }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <button onClick={runScan} disabled={scanning} style={{ background: scanning ? "#ccc" : "#534AB7", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 500, cursor: scanning ? "not-allowed" : "pointer" }}>
            {scanning ? `Scanning... ${scanProgress}%` : "Run Platform Scan"}
          </button>
          <div style={{ display: "flex", borderRadius: 8, border: "0.5px solid #e0e0dc", overflow: "hidden" }}>
            {["alerts", "lineage", "upload"].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: "10px 18px", background: activeTab === tab ? "#EEEDFE" : "white", color: activeTab === tab ? "#3C3489" : "#666", border: "none", cursor: "pointer", fontSize: 13, fontWeight: activeTab === tab ? 500 : 400, textTransform: "capitalize" }}>
                {tab === "lineage" ? "Lineage Graph" : tab}
              </button>
            ))}
          </div>
        </div>

        {scanning && (
          <div style={{ background: "white", borderRadius: 10, padding: 16, marginBottom: 16, border: "0.5px solid #e0e0dc" }}>
            <div style={{ fontSize: 13, color: "#534AB7", marginBottom: 8, fontWeight: 500 }}>Scanning YouTube, Instagram, Twitter, Reddit, Telegram...</div>
            <div style={{ background: "#f0f0f0", borderRadius: 4, height: 6, overflow: "hidden" }}>
              <div style={{ background: "#534AB7", height: "100%", width: `${scanProgress}%`, transition: "width 0.1s", borderRadius: 4 }} />
            </div>
          </div>
        )}

        {activeTab === "alerts" && (
          <div style={{ background: "white", borderRadius: 10, border: "0.5px solid #e0e0dc", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "0.5px solid #e0e0dc", fontWeight: 500, fontSize: 14 }}>
              Live Alerts — {alerts.filter(a => a.status === "stolen").length} stolen detected
            </div>
            {alerts.map(alert => (
              <div key={alert.id} style={{ display: "flex", alignItems: "center", padding: "12px 20px", borderBottom: "0.5px solid #f0f0f0", gap: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: alert.status === "stolen" ? "#E24B4A" : alert.status === "investigating" ? "#EF9F27" : "#639922", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{alert.clip}</div>
                  <div style={{ fontSize: 12, color: "#888" }}>{alert.platform} · {alert.uploader} · {alert.views} views · {alert.time}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 500, color: alert.confidence > 90 ? "#A32D2D" : "#854F0B", background: alert.confidence > 90 ? "#FCEBEB" : "#FAEEDA", padding: "2px 8px", borderRadius: 6 }}>
                  {alert.confidence}% match
                </div>
                {alert.status === "stolen" && (
                  <button onClick={() => generateDMCA(alert)} style={{ background: "#E24B4A", color: "white", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
                    Send DMCA
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === "lineage" && (
          <div style={{ background: "white", borderRadius: 10, border: "0.5px solid #e0e0dc", padding: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>Spread lineage — Kohli Six clip</div>
            <svg width="100%" viewBox="0 0 600 320">
              <circle cx="300" cy="50" r="36" fill="#3B6D11" opacity="0.9" />
              <text x="300" y="45" textAnchor="middle" fill="white" fontSize="10" fontWeight="600">ORIGINAL</text>
              <text x="300" y="58" textAnchor="middle" fill="white" fontSize="9">Disney+ Hotstar</text>
              <line x1="300" y1="86" x2="150" y2="150" stroke="#E24B4A" strokeWidth="2" strokeDasharray="4"/>
              <circle cx="150" cy="170" r="26" fill="#E24B4A" opacity="0.85" />
              <text x="150" y="166" textAnchor="middle" fill="white" fontSize="9" fontWeight="600">Telegram</text>
              <text x="150" y="178" textAnchor="middle" fill="white" fontSize="8">@IPL_Leaks</text>
              <line x1="300" y1="86" x2="450" y2="150" stroke="#E24B4A" strokeWidth="1.5" strokeDasharray="4"/>
              <circle cx="450" cy="170" r="22" fill="#E24B4A" opacity="0.75" />
              <text x="450" y="166" textAnchor="middle" fill="white" fontSize="9" fontWeight="600">YouTube</text>
              <text x="450" y="178" textAnchor="middle" fill="white" fontSize="8">@Cricket99</text>
              <line x1="150" y1="196" x2="80" y2="255" stroke="#E24B4A" strokeWidth="1" strokeDasharray="4"/>
              <circle cx="80" cy="268" r="18" fill="#E24B4A" opacity="0.65" />
              <text x="80" y="264" textAnchor="middle" fill="white" fontSize="8">Instagram</text>
              <text x="80" y="274" textAnchor="middle" fill="white" fontSize="7">@reelking</text>
              <line x1="150" y1="196" x2="220" y2="255" stroke="#E24B4A" strokeWidth="1" strokeDasharray="4"/>
              <circle cx="220" cy="268" r="16" fill="#E24B4A" opacity="0.6" />
              <text x="220" y="264" textAnchor="middle" fill="white" fontSize="8">Instagram</text>
              <text x="220" y="274" textAnchor="middle" fill="white" fontSize="7">@sports24</text>
              <line x1="450" y1="192" x2="510" y2="255" stroke="#E24B4A" strokeWidth="1" strokeDasharray="4"/>
              <circle cx="510" cy="268" r="14" fill="#E24B4A" opacity="0.55" />
              <text x="510" y="264" textAnchor="middle" fill="white" fontSize="8">WhatsApp</text>
              <text x="510" y="274" textAnchor="middle" fill="white" fontSize="7">Group</text>
              <text x="300" y="310" textAnchor="middle" fontSize="11" fill="#888">Strike Telegram source → 4 downstream copies die instantly</text>
            </svg>
          </div>
        )}

        {activeTab === "upload" && (
          <div style={{ background: "white", borderRadius: 10, border: "0.5px solid #e0e0dc", padding: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>Register protected content</div>
            <div style={{ border: "2px dashed #e0e0dc", borderRadius: 10, padding: "40px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
              <div style={{ fontSize: 14, color: "#666", marginBottom: 12 }}>Drag and drop your official video clip here</div>
              <input type="file" accept="video/*,image/*" onChange={(e) => {
                if (e.target.files[0]) {
                  setUploadStatus("Embedding invisible watermark...");
                  setTimeout(() => setUploadStatus("Generating perceptual fingerprint..."), 1200);
                  setTimeout(() => setUploadStatus("Registering audio fingerprint..."), 2200);
                  setTimeout(() => setUploadStatus("✓ Clip registered! Now monitoring 5 platforms for unauthorized copies."), 3200);
                }
              }} style={{ display: "none" }} id="fileup" />
              <label htmlFor="fileup" style={{ background: "#534AB7", color: "white", padding: "10px 24px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 500 }}>Choose file</label>
            </div>
            {uploadStatus && (
              <div style={{ marginTop: 16, padding: "12px 16px", background: uploadStatus.startsWith("✓") ? "#EAF3DE" : "#EEEDFE", borderRadius: 8, fontSize: 13, color: uploadStatus.startsWith("✓") ? "#3B6D11" : "#3C3489", fontWeight: 500 }}>
                {uploadStatus}
              </div>
            )}
          </div>
        )}
      </div>

      {dmcaModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 560, width: "100%", maxHeight: "80vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>DMCA Takedown Notice</div>
              <button onClick={() => setDmcaModal(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#888" }}>×</button>
            </div>
            <textarea value={dmcaText} readOnly style={{ width: "100%", height: 300, fontFamily: "monospace", fontSize: 12, border: "0.5px solid #e0e0dc", borderRadius: 8, padding: 12, resize: "none", background: "#f8f8f8" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => navigator.clipboard.writeText(dmcaText)} style={{ background: "#534AB7", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, cursor: "pointer", fontWeight: 500, flex: 1 }}>Copy & Send</button>
              <button onClick={() => setDmcaModal(null)} style={{ background: "#f0f0f0", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, cursor: "pointer" }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}