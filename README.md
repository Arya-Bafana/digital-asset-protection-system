# Sports Guardian — AI Sports Piracy Detection

> Detect stolen sports clips in 8 seconds. Map the spread. Auto-generate DMCA takedowns.

## Live Demo
🔗 https://digital-asset-protection-system-8m4s6yb1j.vercel.app

## The Problem
Indian sports piracy causes ₹3,200 crore in losses per year. When Kohli hits a six, 2,400 Instagram reels steal the clip within 90 seconds. Tools like NexGuard and StegaWave cost ₹50 lakh/year — completely unaffordable for ISL clubs, kabaddi leagues, and state cricket boards.

## Our Solution
Sports Guardian is an affordable AI-powered piracy detection system that:
- Embeds invisible watermarks into official video content
- Detects stolen copies across YouTube, Instagram, Telegram, Reddit, Twitter in under 30 seconds
- Maps the full spread lineage — showing exactly who leaked it and who reposted from whom
- Auto-generates DMCA takedown notices with one click

## How It Works
1. Rights holder uploads official clip → system embeds invisible watermark + generates perceptual fingerprint
2. Crawler continuously scans social platforms for matching content using 3-layer detection
3. Stolen copy detected in ~8 seconds → alert fires with full lineage graph
4. One click generates and sends DMCA takedown notice

## Detection Engine — 3 Layers
| Layer | Technology | What it catches |
|-------|-----------|----------------|
| Perceptual Hash | pHash + dHash | Direct copies, re-encoded videos |
| Audio Fingerprint | Chromaprint | Flipped/cropped videos with original audio |
| AI Visual Embedding | OpenCLIP | Filtered, recoloured, slowed-down versions |

## What Makes Us Different
| Feature | NexGuard/StegaWave | Sports Guardian |
|---------|-------------------|-----------------|
| Price | ₹50L+/year | ₹50K-2L/year |
| Lineage graph | No | Yes |
| Auto takedown | No | Yes |
| Target customer | Netflix, Disney | ISL, kabaddi, esports |
| Detection time | Hours | 8 seconds |

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React, Recharts, SVG |
| Backend | Python Flask |
| Detection | imagehash, PIL, Chromaprint |
| Deployment | Vercel |

## Target Market
- ISL clubs and Pro
