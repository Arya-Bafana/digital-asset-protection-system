"""
Sports Guardian - AI-Powered Sports Piracy Detection
Flask Backend API

Routes:
  GET  /health   - Server health check + registered clip count
  POST /register - Register a protected image/frame
  POST /scan     - Scan an image/frame for piracy (real or demo mode)
  POST /dmca     - Submit a DMCA takedown report
  POST /compare  - Compare two images directly

Hashing strategy: Triple-hash (pHash + dHash + aHash) via ImageHash library
"""

import os
import time
import uuid
import logging
from io import BytesIO

from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import imagehash

# ─────────────────────────────────────────────
# App Setup
# ─────────────────────────────────────────────

app = Flask(__name__)

# Allow only known frontend origins
CORS(app, resources={r"/*": {"origins": [
    "http://localhost:3000",
    "http://localhost:5173"
]}})

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png"}

# Similarity thresholds (lower hash distance = more similar)
# ImageHash distance: 0 = identical, 64 = completely different
STOLEN_THRESHOLD        = 10   # avg_distance <= 10  → STOLEN        (>85% similar)
INVESTIGATING_THRESHOLD = 18   # avg_distance <= 18  → INVESTIGATING  (70–85% similar)
# avg_distance > 18 → CLEAN (<70% similar)

# ─────────────────────────────────────────────
# In-Memory Database (demo/hackathon)
# ─────────────────────────────────────────────

# Structure: { clip_id: { id, title, filename, hashes, registered_at } }
registered_clips = {}

# Structure: [ { id, clip_id, infringing_url, reporter_name, status, reported_at } ]
dmca_reports = []

# ─────────────────────────────────────────────
# Utility Functions
# ─────────────────────────────────────────────

def allowed_file(filename: str) -> bool:
    """Check if the uploaded file has an allowed extension."""
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def load_image_from_request(file_field: str = "file"):
    """
    Load a PIL Image from a multipart/form-data file upload.

    Returns one of:
      (img, filename, None)   — success
      (None, json_response, status_code) — failure
    """
    if file_field not in request.files:
        return None, jsonify({
            "success": False,
            "message": f"No file uploaded. Expected field: '{file_field}'",
            "data": None
        }), 400

    file = request.files[file_field]

    if file.filename == "":
        return None, jsonify({
            "success": False,
            "message": "Filename is empty. Please select a file.",
            "data": None
        }), 400

    if not allowed_file(file.filename):
        return None, jsonify({
            "success": False,
            "message": (
                f"Invalid file type '{file.filename.rsplit('.', 1)[-1]}'. "
                f"Allowed types: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            ),
            "data": None
        }), 400

    try:
        img = Image.open(BytesIO(file.read())).convert("RGB")
        return img, file.filename, None
    except Exception as e:
        return None, jsonify({
            "success": False,
            "message": f"Could not open image file: {str(e)}",
            "data": None
        }), 400


def compute_triple_hash(img: Image.Image) -> dict:
    """
    Compute three perceptual hashes for an image.

    - pHash (perceptual hash): frequency-domain hash, robust to compression & resizing
    - dHash (difference hash): gradient hash, robust to minor edits
    - aHash (average hash):   fast baseline comparison

    The image is normalized to 256×256 before hashing.
    """
    normalized = img.resize((256, 256), Image.LANCZOS)
    return {
        "phash": str(imagehash.phash(normalized)),
        "dhash": str(imagehash.dhash(normalized)),
        "ahash": str(imagehash.average_hash(normalized)),
    }


def compute_similarity(hashes_a: dict, hashes_b: dict) -> dict:
    """
    Compare two triple-hash fingerprints.

    Returns per-hash distances, average distance, similarity %, verdict, and
    confidence band based on predefined thresholds.
    """
    phash_dist = imagehash.hex_to_hash(hashes_a["phash"]) - imagehash.hex_to_hash(hashes_b["phash"])
    dhash_dist = imagehash.hex_to_hash(hashes_a["dhash"]) - imagehash.hex_to_hash(hashes_b["dhash"])
    ahash_dist = imagehash.hex_to_hash(hashes_a["ahash"]) - imagehash.hex_to_hash(hashes_b["ahash"])

    avg_distance = (phash_dist + dhash_dist + ahash_dist) / 3.0

    # Convert distance to 0–100% similarity (max meaningful distance = 64)
    similarity_pct = round(max(0.0, (1 - avg_distance / 64)) * 100, 2)

    # Verdict based on thresholds
    if avg_distance <= STOLEN_THRESHOLD:
        verdict = "STOLEN"
        confidence_band = "HIGH"        # > 85% similar
    elif avg_distance <= INVESTIGATING_THRESHOLD:
        verdict = "INVESTIGATING"
        confidence_band = "MEDIUM"      # 70–85% similar
    else:
        verdict = "CLEAN"
        confidence_band = "LOW"         # < 70% similar

    return {
        "phash_distance":   phash_dist,
        "dhash_distance":   dhash_dist,
        "ahash_distance":   ahash_dist,
        "avg_distance":     round(avg_distance, 2),
        "similarity_percent": similarity_pct,
        "verdict":          verdict,
        "confidence_band":  confidence_band,
    }


def find_best_match(scan_hashes: dict) -> dict | None:
    """
    Scan all registered clips and return the closest matching clip.
    Returns None if no clips are registered.
    """
    best_match   = None
    best_distance = float("inf")

    for clip_id, clip in registered_clips.items():
        result = compute_similarity(scan_hashes, clip["hashes"])
        if result["avg_distance"] < best_distance:
            best_distance = result["avg_distance"]
            best_match = {
                "clip_id":       clip_id,
                "title":         clip["title"],
                "filename":      clip["filename"],
                "registered_at": clip["registered_at"],
                **result,
            }

    return best_match


# ─────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    """
    GET /health
    Returns server status, registered clip count, and DMCA report count.
    """
    return jsonify({
        "success": True,
        "message": "Sports Guardian API is running",
        "data": {
            "status":            "healthy",
            "registered_clips":  len(registered_clips),
            "dmca_reports":      len(dmca_reports),
            "version":           "1.0.0",
        }
    }), 200


@app.route("/register", methods=["POST"])
def register():
    """
    POST /register
    Register a protected image/frame into the system.

    multipart/form-data fields:
      file  (required) - Image file (jpg, jpeg, png)
      title (optional) - Human-readable label for this clip

    Returns clip_id and triple-hash fingerprint on success.
    Returns 409 if the same content is already registered.
    """
    try:
        result = load_image_from_request("file")
        if result[2] is not None:
            # load_image_from_request returns (None, json_response, status_code) on error
            return result[1], result[2]

        img, filename, _ = result
        title = request.form.get("title", filename).strip() or filename

        # Compute triple-hash fingerprint
        hashes = compute_triple_hash(img)

        # ── Duplicate prevention ──────────────────────────────────────────
        # pHash alone is sufficient for exact-duplicate detection
        for existing in registered_clips.values():
            if existing["hashes"]["phash"] == hashes["phash"]:
                return jsonify({
                    "success": False,
                    "message": "Content already registered. Duplicate not created.",
                    "data": {
                        "existing_clip_id":  existing["id"],
                        "registered_at":     existing["registered_at"],
                    }
                }), 409

        # Build and store clip record
        clip_id       = str(uuid.uuid4())
        registered_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        registered_clips[clip_id] = {
            "id":            clip_id,
            "title":         title,
            "filename":      filename,
            "hashes":        hashes,
            "registered_at": registered_at,
        }

        logger.info(f"[REGISTER] Clip registered — id={clip_id} | title={title}")

        return jsonify({
            "success": True,
            "message": "Image/frame registered successfully",
            "data": {
                "clip_id":       clip_id,
                "title":         title,
                "filename":      filename,
                "hashes":        hashes,
                "registered_at": registered_at,
            }
        }), 201

    except Exception as e:
        logger.error(f"[REGISTER] Unexpected error: {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Server error during registration: {str(e)}",
            "data": None
        }), 500


@app.route("/scan", methods=["POST"])
def scan():
    """
    POST /scan
    Scan an uploaded image/frame for potential piracy.

    Modes:
      real — A file is uploaded via multipart/form-data (field: 'file')
      demo — No file uploaded; returns simulated dashboard data for testing/demo

    Returns scan_mode, verdict, top_match, confidence_band, detection_time_ms.
    """
    try:
        scan_start = time.time()

        # ── Demo mode: no file provided ───────────────────────────────────
        if "file" not in request.files or request.files["file"].filename == "":
            detection_time_ms = round((time.time() - scan_start) * 1000, 2)
            logger.info("[SCAN] Demo mode — no file uploaded")
            return jsonify({
                "success": True,
                "message": "Demo scan complete. Upload a file for a real scan.",
                "data": {
                    "scan_mode":                "demo",
                    "verdict":                  "STOLEN",
                    "confidence_band":          "HIGH",
                    "similarity_percent":       94.3,
                    "avg_distance":             3.7,
                    "top_match": {
                        "clip_id":          "demo-clip-001",
                        "title":            "Premier League Highlights Reel",
                        "filename":         "premier_league_highlights.jpg",
                        "registered_at":    "2025-01-15T10:30:00Z",
                        "similarity_percent": 94.3,
                    },
                    "registered_clips_checked": len(registered_clips) or 12,
                    "detection_time_ms":        detection_time_ms,
                }
            }), 200

        # ── Real mode: file uploaded ──────────────────────────────────────
        result = load_image_from_request("file")
        if result[2] is not None:
            return result[1], result[2]

        img, filename, _ = result

        # Compute hash fingerprint of the scanned image
        scan_hashes = compute_triple_hash(img)

        # Find the closest registered clip
        top_match = find_best_match(scan_hashes)

        detection_time_ms = round((time.time() - scan_start) * 1000, 2)

        if top_match is None:
            return jsonify({
                "success": True,
                "message": "Scan complete. No registered clips to compare against.",
                "data": {
                    "scan_mode":                "real",
                    "scanned_filename":         filename,
                    "verdict":                  "CLEAN",
                    "confidence_band":          "LOW",
                    "similarity_percent":       0,
                    "avg_distance":             None,
                    "top_match":                None,
                    "registered_clips_checked": 0,
                    "detection_time_ms":        detection_time_ms,
                }
            }), 200

        logger.info(
            f"[SCAN] Real scan complete — verdict={top_match['verdict']} | "
            f"similarity={top_match['similarity_percent']}% | file={filename}"
        )

        return jsonify({
            "success": True,
            "message": f"Scan complete. Verdict: {top_match['verdict']}",
            "data": {
                "scan_mode":          "real",
                "scanned_filename":   filename,
                "verdict":            top_match["verdict"],
                "confidence_band":    top_match["confidence_band"],
                "similarity_percent": top_match["similarity_percent"],
                "avg_distance":       top_match["avg_distance"],
                "top_match": {
                    "clip_id":          top_match["clip_id"],
                    "title":            top_match["title"],
                    "filename":         top_match["filename"],
                    "registered_at":    top_match["registered_at"],
                    "similarity_percent": top_match["similarity_percent"],
                    "hash_distances": {
                        "phash": top_match["phash_distance"],
                        "dhash": top_match["dhash_distance"],
                        "ahash": top_match["ahash_distance"],
                    },
                },
                "registered_clips_checked": len(registered_clips),
                "detection_time_ms":        detection_time_ms,
            }
        }), 200

    except Exception as e:
        logger.error(f"[SCAN] Unexpected error: {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Server error during scan: {str(e)}",
            "data": None
        }), 500


@app.route("/dmca", methods=["POST"])
def dmca():
    """
    POST /dmca
    Submit a DMCA takedown notice for pirated content.

    JSON body:
      clip_id         (required) - ID of the registered protected clip
      infringing_url  (required) - URL where pirated content was found
      reporter_name   (optional) - Name of the reporter
      reporter_email  (optional) - Email of the reporter

    Returns report_id and confirmation on success.
    """
    try:
        body = request.get_json(silent=True) or {}

        clip_id         = body.get("clip_id", "").strip()
        infringing_url  = body.get("infringing_url", "").strip()
        reporter_name   = body.get("reporter_name", "Anonymous").strip()
        reporter_email  = body.get("reporter_email", "").strip()

        if not clip_id:
            return jsonify({
                "success": False,
                "message": "Missing required field: clip_id",
                "data": None
            }), 400

        if not infringing_url:
            return jsonify({
                "success": False,
                "message": "Missing required field: infringing_url",
                "data": None
            }), 400

        # Flag whether clip_id is in our registry (still accept if not — piracy is real either way)
        clip_known = clip_id in registered_clips

        report_id   = str(uuid.uuid4())
        reported_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        report = {
            "id":              report_id,
            "clip_id":         clip_id,
            "clip_known":      clip_known,
            "infringing_url":  infringing_url,
            "reporter_name":   reporter_name,
            "reporter_email":  reporter_email,
            "status":          "pending",
            "reported_at":     reported_at,
        }

        dmca_reports.append(report)

        logger.info(
            f"[DMCA] Report submitted — id={report_id} | clip={clip_id} | url={infringing_url}"
        )

        return jsonify({
            "success": True,
            "message": "DMCA takedown notice submitted successfully",
            "data": {
                "report_id":   report_id,
                "clip_id":     clip_id,
                "clip_known":  clip_known,
                "status":      "pending",
                "reported_at": reported_at,
            }
        }), 201

    except Exception as e:
        logger.error(f"[DMCA] Unexpected error: {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Server error during DMCA submission: {str(e)}",
            "data": None
        }), 500


@app.route("/compare", methods=["POST"])
def compare():
    """
    POST /compare
    Directly compare two uploaded image/frames side-by-side.

    multipart/form-data fields:
      file_a (required) - First image  (jpg, jpeg, png)
      file_b (required) - Second image (jpg, jpeg, png)

    Returns per-hash distances, similarity %, verdict, confidence_band, detection_time_ms.
    """
    try:
        compare_start = time.time()

        # Load image A
        result_a = load_image_from_request("file_a")
        if result_a[2] is not None:
            return result_a[1], result_a[2]
        img_a, filename_a, _ = result_a

        # Load image B
        result_b = load_image_from_request("file_b")
        if result_b[2] is not None:
            return result_b[1], result_b[2]
        img_b, filename_b, _ = result_b

        # Compute hashes for both images
        hashes_a = compute_triple_hash(img_a)
        hashes_b = compute_triple_hash(img_b)

        # Run triple-hash similarity comparison
        similarity = compute_similarity(hashes_a, hashes_b)

        detection_time_ms = round((time.time() - compare_start) * 1000, 2)

        logger.info(
            f"[COMPARE] {filename_a} vs {filename_b} — "
            f"verdict={similarity['verdict']} | similarity={similarity['similarity_percent']}%"
        )

        return jsonify({
            "success": True,
            "message": f"Comparison complete. Verdict: {similarity['verdict']}",
            "data": {
                "file_a":             filename_a,
                "file_b":             filename_b,
                "verdict":            similarity["verdict"],
                "confidence_band":    similarity["confidence_band"],
                "similarity_percent": similarity["similarity_percent"],
                "avg_distance":       similarity["avg_distance"],
                "hash_distances": {
                    "phash": similarity["phash_distance"],
                    "dhash": similarity["dhash_distance"],
                    "ahash": similarity["ahash_distance"],
                },
                "hashes": {
                    "file_a": hashes_a,
                    "file_b": hashes_b,
                },
                "detection_time_ms": detection_time_ms,
            }
        }), 200

    except Exception as e:
        logger.error(f"[COMPARE] Unexpected error: {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Server error during comparison: {str(e)}",
            "data": None
        }), 500


# ─────────────────────────────────────────────
# Global Error Handlers
# ─────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({
        "success": False,
        "message": "Endpoint not found",
        "data": None
    }), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({
        "success": False,
        "message": "HTTP method not allowed on this endpoint",
        "data": None
    }), 405


@app.errorhandler(500)
def server_error(e):
    return jsonify({
        "success": False,
        "message": "Internal server error",
        "data": None
    }), 500


# ─────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 55)
    print("  Sports Guardian API  —  Starting up...")
    print("  Endpoints:")
    print("    GET  /health")
    print("    POST /register")
    print("    POST /scan")
    print("    POST /dmca")
    print("    POST /compare")
    print("=" * 55)
    app.run(debug=True, host="0.0.0.0", port=5000)
