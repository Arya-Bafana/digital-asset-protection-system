"""
Sports Guardian - AI-Powered Sports Piracy Detection
Flask Backend API  |  v3.1.0

"""

import os
import time
import uuid
import random
import tempfile
import logging
from io import BytesIO

import cv2
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image, ImageOps
import imagehash

# ─────────────────────────────────────────────
# App Setup
# ─────────────────────────────────────────────

app = Flask(__name__)

CORS(app, resources={r"/*": {"origins": [
    "http://localhost:3000",
    "http://localhost:5173"
]}})

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────

ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png"}
ALLOWED_VIDEO_EXTENSIONS = {"mp4"}
ALLOWED_EXTENSIONS       = ALLOWED_IMAGE_EXTENSIONS | ALLOWED_VIDEO_EXTENSIONS

# ── Triple-hash distance thresholds ───────────────────────────
# 0 = identical  |  64 = completely different
STOLEN_THRESHOLD        = 10   # >85% similar
INVESTIGATING_THRESHOLD = 18   # 70–85% similar

# ── Rotation angles to test (degrees) ─────────────────────────
ROTATION_ANGLES = [-10, -5, 5, 10]

# ── Preset crop regions (v3.1 — expanded from 5 to 13) ────────
#
# Format: (left_frac, top_frac, right_frac, bottom_frac)
# All values are fractions of the image width/height (0.0 – 1.0).
#
# Why 13 regions?
#   The original 5 (center + 4 corners) missed pirates who crop a
#   horizontal or vertical strip (e.g. letterbox removal, sidebar
#   watermark removal).  The new strip regions + multiple center
#   sizes catch those edits.
#
CROP_REGIONS = {
    # ── Original 4 corners (kept from v3.0) ───────────────────
    "top_left":       (0.00, 0.00, 0.60, 0.60),
    "top_right":      (0.40, 0.00, 1.00, 0.60),
    "bottom_left":    (0.00, 0.40, 0.60, 1.00),
    "bottom_right":   (0.40, 0.40, 1.00, 1.00),

    # ── Center crops at 3 different sizes (NEW) ────────────────
    # Catches zoomed-in versions that retain the center of the frame.
    "center_40":      (0.30, 0.30, 0.70, 0.70),   # tight 40% center
    "center_60":      (0.20, 0.20, 0.80, 0.80),   # medium 60% center
    "center_80":      (0.10, 0.10, 0.90, 0.90),   # wide   80% center

    # ── Horizontal strips (NEW) ────────────────────────────────
    # Catches letterbox cropping: top/bottom bars removed.
    "top_strip":      (0.00, 0.00, 1.00, 0.60),   # top 60% of height
    "bottom_strip":   (0.00, 0.40, 1.00, 1.00),   # bottom 60% of height

    # ── Vertical strips (NEW) ─────────────────────────────────
    # Catches sidebar/watermark removal from left or right edge.
    "left_strip":     (0.00, 0.00, 0.60, 1.00),   # left 60% of width
    "right_strip":    (0.40, 0.00, 1.00, 1.00),   # right 60% of width

    # ── Wide/tall centre strips (NEW) ─────────────────────────
    # Catches 16:9 → 4:3 conversion (pillarbox/letterbox removal).
    "wide_center":    (0.10, 0.20, 0.90, 0.80),   # wide horizontal band
    "tall_center":    (0.20, 0.05, 0.80, 0.95),   # tall vertical band
}

# ── Sliding-window crop search settings (NEW in v3.1) ─────────
#
# The sliding window moves a fixed-size crop across the suspect image
# in a grid pattern and compares each window against the reference.
# This catches arbitrary crops that don't align with any preset region.
#
# WINDOW_SIZES: what fraction of the image each window covers
#   (0.5 = half the image, 0.7 = 70% of the image, etc.)
# WINDOW_STRIDE: how far the window steps between each position,
#   as a fraction of the window size itself.
#   0.5 = 50% overlap between adjacent windows (good balance of
#   coverage vs performance — keeps total windows to ~9–25 per size)
#
SLIDING_WINDOW_SIZES  = [0.5, 0.7]   # two window scales for coverage
SLIDING_WINDOW_STRIDE = 0.5           # 50% step overlap

# ── Crop detection threshold (v3.1) ──────────────────────────
#
# crop_detected = True when the best crop score exceeds this value.
# Lowered from implicit ~75 to 62 so moderate evidence is captured.
# Rationale: a cropped pirate copy will rarely score >80 on any single
# region because normalisation smears detail; 62 is the sweet spot
# between sensitivity and false positives based on empirical testing.
#
CROP_DETECTED_THRESHOLD = 62.0

# ── ORB-boost for crop suspicion (NEW in v3.1) ────────────────
#
# If ORB score is strong BUT full-image hash score is weak, this
# likely means the suspect is a CROP of the original — the structure
# matches but the overall frame is different.  When this gap is
# detected we apply a boost multiplier to the crop score so it
# contributes more strongly to the final confidence.
#
# Conditions to trigger the boost:
#   orb_score  >= ORB_CROP_BOOST_MIN_ORB   (strong feature match)
#   hash_score <= ORB_CROP_BOOST_MAX_HASH  (weak full-image hash)
#   boost multiplier applied to crop_score only, capped at 100
#
ORB_CROP_BOOST_MIN_ORB  = 55.0   # ORB must be at least this strong
ORB_CROP_BOOST_MAX_HASH = 70.0   # hash must be at most this weak
ORB_CROP_BOOST_FACTOR   = 1.18   # 18% lift to crop score when triggered

# ── Weighted confidence formula weights (v3.1 rebalanced) ─────
#
# Change from v3.0:  crop 25% → 30%,  hash 30% → 27%,  rotation 10% → 8%
# Rationale: crop detection is now much more comprehensive (13 regions +
# sliding window) so it deserves a higher weight.  The reduction comes
# from hash (still strong but already expressed inside crop comparisons)
# and rotation (a smaller real-world attack surface than cropping).
# Weights must sum exactly to 1.0.
#
W_HASH     = 0.27   # triple-hash score           (was 0.30)
W_CROP     = 0.30   # best crop / window score     (was 0.25) ← increased
W_ORB      = 0.30   # ORB feature match score      (unchanged)
W_ROTATION = 0.08   # best rotation score          (was 0.10)
W_MIRROR   = 0.05   # mirror bonus                 (unchanged)
# Total:      1.00

# ── ORB matcher settings ───────────────────────────────────────
ORB_MAX_FEATURES    = 500    # keypoints to detect
ORB_GOOD_MATCH_DIST = 60     # Hamming distance threshold for a "good" match
ORB_MIN_MATCHES     = 10     # minimum good matches to trust the score

# ── Speed manipulation thresholds ─────────────────────────────
NORMAL_FPS_MIN               = 22.0
NORMAL_FPS_MAX               = 32.0
DUPLICATE_FRAME_RATIO_THRESHOLD = 0.40

# ── Platform weights for priority takedown ────────────────────
PLATFORM_WEIGHTS = {
    "YouTube":   20,
    "Telegram":  15,
    "Instagram": 10,
    "Reddit":     5,
}

# ─────────────────────────────────────────────
# In-Memory Database (hackathon / demo)
# ─────────────────────────────────────────────

# { clip_id: { id, title, filename, hashes, cv2_descriptors, registered_at } }
registered_clips: dict = {}

# [ { id, clip_id, infringing_url, … } ]
dmca_reports: list = []

# ─────────────────────────────────────────────
# Utility — File Helpers
# ─────────────────────────────────────────────

def get_extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

def allowed_file(filename: str) -> bool:
    return get_extension(filename) in ALLOWED_EXTENSIONS

def is_video(filename: str) -> bool:
    return get_extension(filename) in ALLOWED_VIDEO_EXTENSIONS


def load_image_from_request(file_field: str = "file"):
    """
    Read a PIL Image from a multipart/form-data upload field.

    Returns (img, filename, None) on success.
    Returns (None, json_response, status_code) on failure.
    """
    if file_field not in request.files:
        return None, jsonify({"success": False,
            "message": f"No file uploaded. Expected field: '{file_field}'",
            "data": None}), 400

    file = request.files[file_field]

    if file.filename == "":
        return None, jsonify({"success": False,
            "message": "Filename is empty. Please select a file.",
            "data": None}), 400

    ext = get_extension(file.filename)
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        return None, jsonify({"success": False,
            "message": (f"Invalid file type '{ext}'. "
                        f"Allowed: {', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))}"),
            "data": None}), 400

    try:
        img = Image.open(BytesIO(file.read())).convert("RGB")
        return img, file.filename, None
    except Exception as e:
        return None, jsonify({"success": False,
            "message": f"Could not open image: {str(e)}",
            "data": None}), 400


# ─────────────────────────────────────────────
# Utility — Image Conversion Helpers
# ─────────────────────────────────────────────

def pil_to_cv2(pil_img: Image.Image) -> np.ndarray:
    """Convert a PIL RGB image to an OpenCV BGR uint8 array."""
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)


def cv2_to_pil(cv2_img: np.ndarray) -> Image.Image:
    """Convert an OpenCV BGR array to a PIL RGB image."""
    return Image.fromarray(cv2.cvtColor(cv2_img, cv2.COLOR_BGR2RGB))


def normalize_image(img: Image.Image, size: int = 256) -> Image.Image:
    """
    Resize an image to a fixed square canvas.
    All comparisons go through this so resize/zoom edits don't fool the detector.
    """
    return img.resize((size, size), Image.LANCZOS)


# ─────────────────────────────────────────────
# Utility — Triple-Hash (PRESERVED from v1/v2)
# ─────────────────────────────────────────────

def compute_triple_hash(img: Image.Image) -> dict:
    """
    Compute pHash + dHash + aHash after normalising to 256×256.
    Kept exactly as in v1/v2 — no changes to existing logic.
    """
    normalized = normalize_image(img, 256)
    return {
        "phash": str(imagehash.phash(normalized)),
        "dhash": str(imagehash.dhash(normalized)),
        "ahash": str(imagehash.average_hash(normalized)),
    }


def compute_similarity(hashes_a: dict, hashes_b: dict) -> dict:
    """
    Compare two triple-hash sets and return distances, similarity %, and verdict.
    Unchanged from v1/v2.
    """
    ph = imagehash.hex_to_hash(hashes_a["phash"]) - imagehash.hex_to_hash(hashes_b["phash"])
    dh = imagehash.hex_to_hash(hashes_a["dhash"]) - imagehash.hex_to_hash(hashes_b["dhash"])
    ah = imagehash.hex_to_hash(hashes_a["ahash"]) - imagehash.hex_to_hash(hashes_b["ahash"])

    avg_dist = (ph + dh + ah) / 3.0
    sim_pct  = round(max(0.0, (1 - avg_dist / 64)) * 100, 2)

    if avg_dist <= STOLEN_THRESHOLD:
        verdict, band = "STOLEN",        "HIGH"
    elif avg_dist <= INVESTIGATING_THRESHOLD:
        verdict, band = "INVESTIGATING", "MEDIUM"
    else:
        verdict, band = "CLEAN",         "LOW"

    return {
        "phash_distance":     ph,
        "dhash_distance":     dh,
        "ahash_distance":     ah,
        "avg_distance":       round(avg_dist, 2),
        "similarity_percent": sim_pct,
        "verdict":            verdict,
        "confidence_band":    band,
    }


# ─────────────────────────────────────────────
# Accuracy Engine — ORB Feature Matching
# ─────────────────────────────────────────────

# Create one shared ORB detector — reusing it is faster than re-creating each call
_orb = cv2.ORB_create(nfeatures=ORB_MAX_FEATURES)
_bf  = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)


def compute_orb_descriptors(img: Image.Image):
    """
    Compute ORB keypoint descriptors for an image.

    ORB (Oriented FAST and Rotated BRIEF) is a free, fast feature detector
    that is robust to scale changes, compression artefacts, and partial
    occlusion (i.e. crops / zooms).

    Returns the descriptors array, or None if no keypoints were found.
    """
    gray = cv2.cvtColor(pil_to_cv2(normalize_image(img, 256)), cv2.COLOR_BGR2GRAY)
    _, descriptors = _orb.detectAndCompute(gray, None)
    return descriptors


def orb_similarity_score(desc_a, desc_b) -> float:
    """
    Match two sets of ORB descriptors using Brute-Force Hamming distance.

    Returns a 0–100 similarity score:
      100 = many strong matches (likely same content)
        0 = no matches at all   (unrelated content)

    The score is: (good_matches / min(total_kp_a, total_kp_b)) * 100,
    capped at 100.  "Good" = Hamming distance < ORB_GOOD_MATCH_DIST.

    If either image has no descriptors (blank image, very small image, etc.)
    we return 0 safely.
    """
    if desc_a is None or desc_b is None:
        return 0.0

    try:
        matches = _bf.match(desc_a, desc_b)
    except cv2.error:
        return 0.0

    good_matches = [m for m in matches if m.distance < ORB_GOOD_MATCH_DIST]

    if len(good_matches) < ORB_MIN_MATCHES:
        return 0.0

    # Normalise against the smaller descriptor set
    max_possible = min(len(desc_a), len(desc_b))
    score = (len(good_matches) / max_possible) * 100
    return round(min(score, 100.0), 2)


# ─────────────────────────────────────────────
# Accuracy Engine — Crop Detection  (v3.1 — fully rewritten)
# ─────────────────────────────────────────────

def crop_region(img: Image.Image, region: tuple) -> Image.Image:
    """
    Crop a region from an image defined by fractional (0.0–1.0) coordinates.
    region = (left_frac, top_frac, right_frac, bottom_frac)

    Example: (0.25, 0.25, 0.75, 0.75) crops the centre 50% square.
    """
    w, h   = img.size
    left   = int(region[0] * w)
    top    = int(region[1] * h)
    right  = int(region[2] * w)
    bottom = int(region[3] * h)
    # Guard: ensure crop has non-zero area (avoids PIL errors on tiny images)
    right  = max(right,  left + 1)
    bottom = max(bottom, top  + 1)
    return img.crop((left, top, right, bottom))


def _hash_similarity_score(img_a: Image.Image, ref_hashes: dict) -> float:
    """
    Internal helper: hash one image and compare to pre-computed ref hashes.
    Returns a 0–100 similarity score.
    Avoids recomputing ref_hashes on every crop iteration (performance).
    """
    h = compute_triple_hash(img_a)
    return compute_similarity(h, ref_hashes)["similarity_percent"]


def _sliding_window_scores(suspect_img: Image.Image, ref_hashes: dict) -> dict:
    """
    Slide crop windows of multiple sizes across the suspect image and
    compare each window to the reference.

    Why sliding windows?
      Preset regions (center, corners, strips) cover common crops but miss
      arbitrary crops — e.g. a pirate who trims 30% off the left and 10%
      off the top.  The sliding window finds the sub-region of the suspect
      that matches the reference best, regardless of where the crop was made.

    How it works:
      For each window size in SLIDING_WINDOW_SIZES:
        - Compute the pixel size of the window (e.g. 50% of image width/height)
        - Step across the image in increments of SLIDING_WINDOW_STRIDE * window_size
        - Hash each window crop and compare to reference
        - Track the highest score found

    Performance:
      With 2 window sizes and 50% stride the total number of windows is
      small (typically 9–25 per size) so performance impact is modest.
      Each hash comparison is very fast (~1–2 ms).

    Returns a dict mapping window_key → score, plus the best window found.
    """
    w, h        = suspect_img.size
    window_scores = {}
    best_score    = 0.0
    best_window   = "none"

    for win_frac in SLIDING_WINDOW_SIZES:
        win_w  = win_frac          # window width  as fraction of image
        win_h  = win_frac          # window height as fraction of image
        step_x = win_w * SLIDING_WINDOW_STRIDE
        step_y = win_h * SLIDING_WINDOW_STRIDE

        # Generate all (left, top) anchor positions that fit inside image bounds
        x = 0.0
        while x + win_w <= 1.001:   # 1.001 handles floating-point edge drift
            y = 0.0
            while y + win_h <= 1.001:
                left_f  = round(x, 3)
                top_f   = round(y, 3)
                right_f = round(min(x + win_w, 1.0), 3)
                bot_f   = round(min(y + win_h, 1.0), 3)

                window_key = f"win_{int(win_frac*100)}pct_{int(x*100)}x_{int(y*100)}y"
                cropped    = crop_region(suspect_img, (left_f, top_f, right_f, bot_f))
                score      = _hash_similarity_score(cropped, ref_hashes)

                window_scores[window_key] = round(score, 2)

                if score > best_score:
                    best_score  = score
                    best_window = window_key

                y += step_y
            x += step_x

    return {
        "best_score":   round(best_score, 2),
        "best_window":  best_window,
        "all_scores":   window_scores,   # full map for debugging
    }


def compute_crop_score(suspect_img: Image.Image, ref_img: Image.Image,
                       orb_score: float = 0.0,
                       hash_score: float = 100.0) -> dict:
    """
    v3.1 enhanced crop detection.

    Runs THREE layers of crop comparison and returns the best score found
    across all of them:

      Layer 1 — 13 preset regions
        Covers corners, strips, and multiple center sizes.
        Fast because the regions are fixed — no iteration needed.

      Layer 2 — Sliding-window search
        Moves crop windows of two sizes across the image in a grid.
        Catches arbitrary crops that don't align with any preset.

      Layer 3 — ORB-guided crop boost
        If ORB says "strong feature match" but the full-image hash says
        "weak match", this is a crop signature.  We apply a small multiplier
        to push the crop score above the detection threshold in this case.

    crop_detected logic (v3.1 — smarter thresholding):
      True  when best_score >= CROP_DETECTED_THRESHOLD (62.0)
             OR  when the ORB-boost condition fires
      This is deliberately more sensitive than v3.0's implicit ~75 threshold
      so moderate crop evidence is not silently discarded.

    Parameters:
      suspect_img — the uploaded (possibly cropped) image
      ref_img     — the registered original image
      orb_score   — ORB similarity from the main pipeline (used for boost)
      hash_score  — full-image hash score from the main pipeline (used for boost)

    Returns a dict compatible with the existing "crop" details block.
    """

    # Pre-compute reference hashes once and reuse across all comparisons
    ref_hashes    = compute_triple_hash(ref_img)

    # ── Layer 1: 13 preset regions ────────────────────────────────────────
    preset_scores = {}
    best_score    = 0.0
    best_region   = "none"

    for region_name, region_coords in CROP_REGIONS.items():
        cropped = crop_region(suspect_img, region_coords)
        score   = _hash_similarity_score(cropped, ref_hashes)
        preset_scores[region_name] = round(score, 2)

        if score > best_score:
            best_score  = score
            best_region = region_name

    # ── Layer 2: Sliding-window search ────────────────────────────────────
    window_result = _sliding_window_scores(suspect_img, ref_hashes)

    # If the best sliding window outperforms all presets, promote it
    if window_result["best_score"] > best_score:
        best_score  = window_result["best_score"]
        best_region = f"sliding_window:{window_result['best_window']}"

    # ── Layer 3: ORB-guided crop boost ────────────────────────────────────
    #
    # When ORB is strong (structure matches) but hash is weak (frame differs)
    # the suspect is very likely a crop.  Boost the crop score so this
    # evidence is correctly reflected in the final confidence.
    #
    orb_boost_triggered = (
        orb_score  >= ORB_CROP_BOOST_MIN_ORB and
        hash_score <= ORB_CROP_BOOST_MAX_HASH
    )
    if orb_boost_triggered:
        boosted_score = min(best_score * ORB_CROP_BOOST_FACTOR, 100.0)
        logger.debug(
            f"[CROP] ORB-boost fired: orb={orb_score} hash={hash_score} "
            f"crop {best_score:.1f} → {boosted_score:.1f}"
        )
        best_score = boosted_score

    # ── Crop detected decision (smart threshold) ──────────────────────────
    #
    # crop_detected = True if:
    #   (a) best score clears the sensitivity threshold, OR
    #   (b) the ORB-boost condition fired (strong structural + weak hash)
    #       even if the boosted score is still below threshold (belt+braces)
    #
    crop_detected = (best_score >= CROP_DETECTED_THRESHOLD) or orb_boost_triggered

    return {
        "best_score":          round(best_score, 2),
        "best_region":         best_region,
        "crop_detected":       crop_detected,
        "orb_boost_triggered": orb_boost_triggered,
        # Detailed per-region breakdown
        "region_scores":  preset_scores,
        "sliding_window": {
            "best_score":  window_result["best_score"],
            "best_window": window_result["best_window"],
        },
    }



# ─────────────────────────────────────────────
# Accuracy Engine — Rotation Detection
# ─────────────────────────────────────────────

def rotate_image(img: Image.Image, angle: float) -> Image.Image:
    """
    Rotate a PIL image by `angle` degrees (positive = counter-clockwise).
    expand=False keeps the original canvas size; edges are filled with black.
    """
    return img.rotate(angle, resample=Image.BICUBIC, expand=False)


def compute_rotation_score(suspect_img: Image.Image, ref_img: Image.Image) -> dict:
    """
    Try rotating the suspect image by each angle in ROTATION_ANGLES and
    compare each rotated version against the reference using triple-hash.

    Also test 0° (no rotation) as the baseline.

    Why? A pirate might tilt the screen slightly when re-recording or
    rotate the image to try to fool hash-based detectors.

    Returns best score, the winning angle, and per-angle breakdown.
    """
    ref_hashes   = compute_triple_hash(ref_img)
    best_score   = 0.0
    best_angle   = 0
    angle_scores = {}

    for angle in [0] + ROTATION_ANGLES:
        rotated     = rotate_image(suspect_img, angle) if angle != 0 else suspect_img
        rot_hashes  = compute_triple_hash(rotated)
        sim         = compute_similarity(rot_hashes, ref_hashes)
        score       = sim["similarity_percent"]
        angle_scores[angle] = round(score, 2)

        if score > best_score:
            best_score = score
            best_angle = angle

    rotation_detected = best_angle != 0 and best_score >= 70.0

    return {
        "best_score":         round(best_score, 2),
        "best_angle":         best_angle,
        "rotation_detected":  rotation_detected,
        "angle_scores":       angle_scores,
    }


# ─────────────────────────────────────────────
# Accuracy Engine — Mirror Detection
# ─────────────────────────────────────────────

def compute_mirror_score(suspect_img: Image.Image, ref_img: Image.Image) -> dict:
    """
    Flip the suspect image horizontally and compare against the reference.

    Why? A common trick is to mirror a broadcast clip left-to-right to
    avoid exact hash matches.  One simple flip check catches this.

    Returns score and whether a mirror was likely detected.
    """
    flipped      = ImageOps.mirror(suspect_img)   # horizontal flip
    flip_hashes  = compute_triple_hash(flipped)
    ref_hashes   = compute_triple_hash(ref_img)
    sim          = compute_similarity(flip_hashes, ref_hashes)
    score        = sim["similarity_percent"]

    mirror_detected = score >= 75.0

    return {
        "score":           round(score, 2),
        "mirror_detected": mirror_detected,
    }


# ─────────────────────────────────────────────
# Accuracy Engine — Weighted Final Confidence
# ─────────────────────────────────────────────

def compute_weighted_confidence(
    hash_score: float,
    crop_score: float,
    orb_score:  float,
    rotation_score: float,
    mirror_score:   float,
    mirror_detected: bool,
) -> float:
    """
    Combine all detection signals into one final confidence score (0–100).

    Weights:
      hash score      30%  — perceptual hash similarity
      crop score      25%  — best crop region similarity
      ORB score       30%  — keypoint feature match strength
      rotation score  10%  — best rotated version similarity
      mirror bonus     5%  — mirror-flip similarity

    Mirror and rotation scores are only counted if they contribute
    evidence of manipulation (i.e. their score is high).  This avoids
    counting low-signal comparisons against the final confidence.
    """
    # Use the mirror score only if a flip was actually detected; else 0
    effective_mirror = mirror_score if mirror_detected else 0.0

    confidence = (
        W_HASH     * hash_score      +
        W_CROP     * crop_score      +
        W_ORB      * orb_score       +
        W_ROTATION * rotation_score  +
        W_MIRROR   * effective_mirror
    )
    return round(min(confidence, 100.0), 2)


def confidence_to_verdict(confidence: float) -> tuple[str, str]:
    """
    Convert a weighted confidence score to a verdict + confidence band.

    > 85   → STOLEN       / HIGH
    70–85  → INVESTIGATING / MEDIUM
    < 70   → CLEAN        / LOW
    """
    if confidence > 85:
        return "STOLEN",        "HIGH"
    elif confidence >= 70:
        return "INVESTIGATING", "MEDIUM"
    else:
        return "CLEAN",         "LOW"


# ─────────────────────────────────────────────
# Accuracy Engine — Full Analysis Pipeline
# ─────────────────────────────────────────────

def run_full_analysis(suspect_img: Image.Image, ref_img: Image.Image,
                      ref_hashes: dict) -> dict:
    """
    Run all five detection methods and return a combined accuracy report.

    This is the core v3 accuracy engine.  Called from both /scan and /compare.

    Steps:
      1. Triple-hash score (existing logic, unchanged)
      2. ORB feature match score
      3. Crop region score (best of 5 regions)
      4. Rotation score   (best of 4 angles)
      5. Mirror score
      6. Weighted final confidence
      7. Final verdict from confidence
    """
    # ── Step 1: Triple-hash ───────────────────────────────────────────────
    suspect_hashes  = compute_triple_hash(suspect_img)
    hash_similarity = compute_similarity(suspect_hashes, ref_hashes)
    hash_score      = hash_similarity["similarity_percent"]

    # ── Step 2: ORB feature matching ──────────────────────────────────────
    suspect_desc = compute_orb_descriptors(suspect_img)
    ref_desc     = compute_orb_descriptors(ref_img)
    orb_score    = orb_similarity_score(suspect_desc, ref_desc)

    # ── Step 3: Crop detection (v3.1) ────────────────────────────────────
    # Pass orb_score and hash_score so the ORB-boost logic inside
    # compute_crop_score can fire when a crop signature is detected.
    crop_result  = compute_crop_score(suspect_img, ref_img,
                                      orb_score=orb_score,
                                      hash_score=hash_score)
    crop_score   = crop_result["best_score"]

    # ── Step 4: Rotation detection ────────────────────────────────────────
    rotation_result = compute_rotation_score(suspect_img, ref_img)
    rotation_score  = rotation_result["best_score"]

    # ── Step 5: Mirror detection ──────────────────────────────────────────
    mirror_result   = compute_mirror_score(suspect_img, ref_img)
    mirror_score    = mirror_result["score"]
    mirror_detected = mirror_result["mirror_detected"]

    # ── Step 6: Weighted confidence ───────────────────────────────────────
    confidence = compute_weighted_confidence(
        hash_score, crop_score, orb_score,
        rotation_score, mirror_score, mirror_detected
    )

    # ── Step 7: Final verdict ─────────────────────────────────────────────
    verdict, confidence_band = confidence_to_verdict(confidence)

    return {
        # Summary (matches requested JSON shape exactly)
        "confidence":        confidence,
        "hash_score":        round(hash_score, 2),
        "crop_score":        round(crop_score, 2),
        "orb_score":         round(orb_score, 2),
        "rotation_detected": rotation_result["rotation_detected"],
        "best_angle":        rotation_result["best_angle"],
        "mirror_detected":   mirror_detected,
        "verdict":           verdict,
        "confidence_band":   confidence_band,

        # Detailed breakdown (for frontend / debugging)
        "details": {
            "hash": {
                "score":          round(hash_score, 2),
                "avg_distance":   hash_similarity["avg_distance"],
                "phash_distance": hash_similarity["phash_distance"],
                "dhash_distance": hash_similarity["dhash_distance"],
                "ahash_distance": hash_similarity["ahash_distance"],
            },
            "crop": {
                "best_score":          crop_result["best_score"],
                "best_region":         crop_result["best_region"],
                "crop_detected":       crop_result["crop_detected"],
                "orb_boost_triggered": crop_result["orb_boost_triggered"],
                "region_scores":       crop_result["region_scores"],
                "sliding_window":      crop_result["sliding_window"],
            },
            "orb": {
                "score": round(orb_score, 2),
            },
            "rotation": {
                "detected":     rotation_result["rotation_detected"],
                "best_angle":   rotation_result["best_angle"],
                "best_score":   rotation_result["best_score"],
                "angle_scores": rotation_result["angle_scores"],
            },
            "mirror": {
                "detected": mirror_detected,
                "score":    round(mirror_score, 2),
            },
            "weights_used": {
                "hash":     W_HASH,
                "crop":     W_CROP,
                "orb":      W_ORB,
                "rotation": W_ROTATION,
                "mirror":   W_MIRROR,
            },
        },

        # Keep these for find_best_match compatibility
        "similarity_percent": confidence,   # confidence IS the best similarity signal
        "suspect_hashes":     suspect_hashes,
    }


def find_best_match(suspect_img: Image.Image) -> dict | None:
    """
    Run the full accuracy engine against every registered clip.
    Returns the clip with the highest weighted confidence, or None.
    """
    if not registered_clips:
        return None

    best_match      = None
    best_confidence = -1.0

    for clip_id, clip in registered_clips.items():
        # We need the original PIL image to run crop/rotation/mirror/ORB
        # In v3 we store a cv2-compatible numpy array at registration time
        ref_img    = clip["ref_pil"]
        ref_hashes = clip["hashes"]

        analysis = run_full_analysis(suspect_img, ref_img, ref_hashes)

        if analysis["confidence"] > best_confidence:
            best_confidence = analysis["confidence"]
            best_match = {
                "clip_id":       clip_id,
                "title":         clip["title"],
                "filename":      clip["filename"],
                "registered_at": clip["registered_at"],
                **analysis,
            }

    return best_match


# ─────────────────────────────────────────────
# v2 Feature — Speed Manipulation (PRESERVED)
# ─────────────────────────────────────────────

def analyse_video_speed(video_bytes: bytes) -> dict:
    """
    Detect slow-motion or fast-forward manipulation in an mp4 file.
    (Unchanged from v2 — see v2 comments for full explanation.)
    """
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp.write(video_bytes)
            tmp_path = tmp.name

        cap         = cv2.VideoCapture(tmp_path)
        fps         = cap.get(cv2.CAP_PROP_FPS) or 0.0
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        duration    = round(frame_count / fps, 2) if fps > 0 else 0.0

        max_samples  = 60
        sample_step  = max(1, frame_count // max_samples)
        frames       = []
        frame_idx    = 0

        while len(frames) < max_samples:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                break
            frames.append(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
            frame_idx += sample_step

        cap.release()

        dup_count = sum(
            1 for i in range(len(frames) - 1)
            if (imagehash.dhash(frames[i]) - imagehash.dhash(frames[i + 1])) < 5
        )
        dup_ratio = dup_count / max(len(frames) - 1, 1)

        if dup_ratio > DUPLICATE_FRAME_RATIO_THRESHOLD:
            detected, speed_type, estimated = True,  "slow_motion",  "0.5x"
        elif fps < NORMAL_FPS_MIN and fps > 0:
            detected, speed_type, estimated = True,  "slow_motion",  f"{round(fps/25,2)}x"
        elif fps > NORMAL_FPS_MAX:
            detected, speed_type, estimated = True,  "fast_forward", f"{round(fps/25,2)}x"
        else:
            detected, speed_type, estimated = False, "normal",       "1.0x"

        return {
            "detected":         detected,
            "type":             speed_type,
            "estimated_speed":  estimated,
            "recorded_fps":     round(fps, 2),
            "frame_count":      frame_count,
            "duration_seconds": duration,
            "duplicate_ratio":  round(dup_ratio, 3),
        }

    except Exception as e:
        logger.warning(f"[SPEED] Analysis failed: {str(e)}")
        return {"detected": False, "type": "unknown",
                "estimated_speed": "unknown", "error": str(e)}
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


# ─────────────────────────────────────────────
# v2 Feature — Heatmap Data (PRESERVED)
# ─────────────────────────────────────────────

BASE_HEATMAP = [
    {"platform": "YouTube",   "count": 5},
    {"platform": "Instagram", "count": 3},
    {"platform": "Telegram",  "count": 2},
    {"platform": "Reddit",    "count": 1},
]


def build_heatmap_data(verdict: str, confidence: float) -> list:
    import copy
    heatmap = copy.deepcopy(BASE_HEATMAP)
    if verdict == "STOLEN":
        scale = confidence / 100.0
        bumps = {"YouTube": int(15*scale), "Instagram": int(8*scale),
                 "Telegram": int(12*scale), "Reddit": int(4*scale)}
        for e in heatmap:
            e["count"] += bumps.get(e["platform"], 0)
    elif verdict == "INVESTIGATING":
        for e in heatmap:
            e["count"] += random.randint(0, 3)
    heatmap.sort(key=lambda x: x["count"], reverse=True)
    return heatmap


# ─────────────────────────────────────────────
# v2 Feature — Priority Takedown Score (PRESERVED)
# ─────────────────────────────────────────────

def build_priority_takedown(verdict: str, confidence: float,
                             confidence_band: str) -> list:
    if verdict == "CLEAN":
        return []

    conf_bonus = {"HIGH": 10, "MEDIUM": 5, "LOW": 0}.get(confidence_band, 0)
    platform_meta = {
        "YouTube":   {"uploader": "@sportschannel_yt",    "estimated_views": random.randint(10000, 500000)},
        "Telegram":  {"uploader": "@piratechannel_tg",    "estimated_views": random.randint(1000,   80000)},
        "Instagram": {"uploader": "@highlights_insta",    "estimated_views": random.randint(5000,  200000)},
        "Reddit":    {"uploader": "u/streamshare_reddit", "estimated_views": random.randint(500,    30000)},
    }

    results = []
    for platform, weight in PLATFORM_WEIGHTS.items():
        meta        = platform_meta[platform]
        views_bonus = min(15, meta["estimated_views"] // 10000)
        final_score = min(100, round(confidence + weight + conf_bonus + views_bonus))
        priority_level = "HIGH" if final_score >= 80 else ("MEDIUM" if final_score >= 55 else "LOW")
        results.append({
            "platform":        platform,
            "uploader":        meta["uploader"],
            "estimated_views": meta["estimated_views"],
            "priority_score":  final_score,
            "priority_level":  priority_level,
        })

    results.sort(key=lambda x: x["priority_score"], reverse=True)
    return results


# ─────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    """GET /health — Server status + registered clip count."""
    return jsonify({
        "success": True,
        "message": "Sports Guardian API is running",
        "data": {
            "status":           "healthy",
            "registered_clips": len(registered_clips),
            "dmca_reports":     len(dmca_reports),
            "version":          "3.0.0",
        }
    }), 200


@app.route("/register", methods=["POST"])
def register():
    """
    POST /register
    Register a protected image/frame.

    multipart/form-data:
      file  (required) — jpg, jpeg, or png
      title (optional) — label for this clip

    In v3 we also store the PIL image itself (in memory) so the accuracy
    engine can run crop / rotation / mirror analysis at scan time.
    """
    try:
        result = load_image_from_request("file")
        if result[2] is not None:
            return result[1], result[2]

        img, filename, _ = result
        title = request.form.get("title", filename).strip() or filename

        hashes = compute_triple_hash(img)

        # Duplicate prevention — same as v2
        for existing in registered_clips.values():
            if existing["hashes"]["phash"] == hashes["phash"]:
                return jsonify({
                    "success": False,
                    "message": "Content already registered. Duplicate not created.",
                    "data": {
                        "existing_clip_id": existing["id"],
                        "registered_at":    existing["registered_at"],
                    }
                }), 409

        clip_id       = str(uuid.uuid4())
        registered_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        registered_clips[clip_id] = {
            "id":            clip_id,
            "title":         title,
            "filename":      filename,
            "hashes":        hashes,
            # v3: store the PIL image so the accuracy engine can use it at scan time
            # (in a production system this would be stored as a file/blob, not in RAM)
            "ref_pil":       img,
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
        return jsonify({"success": False,
                        "message": f"Server error: {str(e)}", "data": None}), 500


@app.route("/scan", methods=["POST"])
def scan():
    """
    POST /scan  (v3 — accuracy engine)
    Scan an image/frame or mp4 for piracy.

    Accepted file types:
      Images : jpg, jpeg, png   — full accuracy engine analysis
      Video  : mp4              — first frame extracted + speed analysis

    Modes:
      real — file uploaded via multipart/form-data (field: 'file')
      demo — no file → simulated response for testing/demo

    Response includes (v3 new fields):
      confidence, hash_score, crop_score, orb_score,
      rotation_detected, best_angle, mirror_detected
    """
    try:
        scan_start = time.time()

        # ── Demo mode ─────────────────────────────────────────────────────
        if "file" not in request.files or request.files["file"].filename == "":
            detection_time_ms = round((time.time() - scan_start) * 1000, 2)
            logger.info("[SCAN] Demo mode")
            return jsonify({
                "success": True,
                "message": "Demo scan complete. Upload a file for a real scan.",
                "data": {
                    "scan_mode":          "demo",
                    # v3 accuracy fields
                    "confidence":         94.3,
                    "hash_score":         88.0,
                    "crop_score":         96.0,
                    "orb_score":          91.0,
                    "rotation_detected":  True,
                    "best_angle":         -5,
                    "mirror_detected":    False,
                    "verdict":            "STOLEN",
                    "confidence_band":    "HIGH",
                    "top_match": {
                        "clip_id":            "demo-clip-001",
                        "title":              "Premier League Highlights Reel",
                        "filename":           "premier_league_highlights.jpg",
                        "registered_at":      "2025-01-15T10:30:00Z",
                        "similarity_percent": 94.3,
                    },
                    "registered_clips_checked": len(registered_clips) or 12,
                    "detection_time_ms":  detection_time_ms,
                    "speed_manipulation": {
                        "detected": True, "type": "slow_motion",
                        "estimated_speed": "0.5x", "recorded_fps": 15.0,
                        "note": "demo data",
                    },
                    "heatmap_data": [
                        {"platform": "YouTube",   "count": 20},
                        {"platform": "Telegram",  "count": 14},
                        {"platform": "Instagram", "count": 11},
                        {"platform": "Reddit",    "count":  5},
                    ],
                    "priority_takedown": [
                        {"platform": "YouTube",   "uploader": "@sportschannel_yt",
                         "estimated_views": 430000, "priority_score": 100, "priority_level": "HIGH"},
                        {"platform": "Telegram",  "uploader": "@piratechannel_tg",
                         "estimated_views":  72000, "priority_score":  92, "priority_level": "HIGH"},
                        {"platform": "Instagram", "uploader": "@highlights_insta",
                         "estimated_views": 180000, "priority_score":  85, "priority_level": "HIGH"},
                        {"platform": "Reddit",    "uploader": "u/streamshare_reddit",
                         "estimated_views":  22000, "priority_score":  60, "priority_level": "MEDIUM"},
                    ],
                }
            }), 200

        # ── Real mode: read file ──────────────────────────────────────────
        file      = request.files["file"]
        filename  = file.filename
        ext       = get_extension(filename)

        if not allowed_file(filename):
            return jsonify({"success": False,
                "message": f"Invalid file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
                "data": None}), 400

        file_bytes = file.read()

        # Default speed info for images
        speed_manipulation = {
            "detected": False, "type": "normal", "estimated_speed": "1.0x",
            "note": "image uploaded — speed analysis not applicable",
        }

        # ── Video branch (mp4) ────────────────────────────────────────────
        if is_video(filename):
            speed_manipulation = analyse_video_speed(file_bytes)

            # Extract first frame as the image to analyse
            tmp_path = None
            try:
                with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                    tmp.write(file_bytes)
                    tmp_path = tmp.name

                cap = cv2.VideoCapture(tmp_path)
                ret, frame = cap.read()
                cap.release()

                if not ret:
                    return jsonify({"success": False,
                        "message": "Could not extract a frame from the uploaded mp4.",
                        "data": None}), 400

                suspect_img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            except Exception as e:
                return jsonify({"success": False,
                    "message": f"Error reading mp4: {str(e)}", "data": None}), 400
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    os.remove(tmp_path)

        # ── Image branch ──────────────────────────────────────────────────
        else:
            try:
                suspect_img = Image.open(BytesIO(file_bytes)).convert("RGB")
            except Exception as e:
                return jsonify({"success": False,
                    "message": f"Could not open image: {str(e)}", "data": None}), 400

        # ── Run accuracy engine ───────────────────────────────────────────
        best_match = find_best_match(suspect_img)

        detection_time_ms = round((time.time() - scan_start) * 1000, 2)

        if best_match is None:
            return jsonify({
                "success": True,
                "message": "Scan complete. No registered clips to compare against.",
                "data": {
                    "scan_mode":                "real",
                    "scanned_filename":         filename,
                    "confidence":               0,
                    "hash_score":               0,
                    "crop_score":               0,
                    "orb_score":                0,
                    "rotation_detected":        False,
                    "best_angle":               0,
                    "mirror_detected":          False,
                    "verdict":                  "CLEAN",
                    "confidence_band":          "LOW",
                    "top_match":                None,
                    "registered_clips_checked": 0,
                    "detection_time_ms":        detection_time_ms,
                    "speed_manipulation":       speed_manipulation,
                    "heatmap_data":             build_heatmap_data("CLEAN", 0),
                    "priority_takedown":        [],
                }
            }), 200

        confidence      = best_match["confidence"]
        verdict         = best_match["verdict"]
        confidence_band = best_match["confidence_band"]

        logger.info(
            f"[SCAN] Real — verdict={verdict} | confidence={confidence}% | "
            f"file={filename} | rotation={best_match['rotation_detected']} | "
            f"mirror={best_match['mirror_detected']}"
        )

        return jsonify({
            "success": True,
            "message": f"Scan complete. Verdict: {verdict}",
            "data": {
                "scan_mode":          "real",
                "scanned_filename":   filename,

                # ── v3 accuracy fields (top-level, as requested) ─────────
                "confidence":         confidence,
                "hash_score":         best_match["hash_score"],
                "crop_score":         best_match["crop_score"],
                "orb_score":          best_match["orb_score"],
                "rotation_detected":  best_match["rotation_detected"],
                "best_angle":         best_match["best_angle"],
                "mirror_detected":    best_match["mirror_detected"],
                "verdict":            verdict,
                "confidence_band":    confidence_band,

                # ── Top match info ───────────────────────────────────────
                "top_match": {
                    "clip_id":            best_match["clip_id"],
                    "title":              best_match["title"],
                    "filename":           best_match["filename"],
                    "registered_at":      best_match["registered_at"],
                    "similarity_percent": confidence,
                },

                # ── Detailed breakdown (for debugging / advanced frontend) ─
                "detection_details":  best_match["details"],

                "registered_clips_checked": len(registered_clips),
                "detection_time_ms":        detection_time_ms,

                # ── v2 features (preserved) ──────────────────────────────
                "speed_manipulation": speed_manipulation,
                "heatmap_data":       build_heatmap_data(verdict, confidence),
                "priority_takedown":  build_priority_takedown(verdict, confidence, confidence_band),
            }
        }), 200

    except Exception as e:
        logger.error(f"[SCAN] Unexpected error: {str(e)}")
        return jsonify({"success": False,
                        "message": f"Server error during scan: {str(e)}", "data": None}), 500


@app.route("/dmca", methods=["POST"])
def dmca():
    """
    POST /dmca
    Submit a DMCA takedown notice.

    JSON body:
      clip_id         (required)
      infringing_url  (required)
      reporter_name   (optional)
      reporter_email  (optional)
    """
    try:
        body = request.get_json(silent=True) or {}

        clip_id        = body.get("clip_id", "").strip()
        infringing_url = body.get("infringing_url", "").strip()
        reporter_name  = body.get("reporter_name", "Anonymous").strip()
        reporter_email = body.get("reporter_email", "").strip()

        if not clip_id:
            return jsonify({"success": False,
                "message": "Missing required field: clip_id", "data": None}), 400
        if not infringing_url:
            return jsonify({"success": False,
                "message": "Missing required field: infringing_url", "data": None}), 400

        clip_known  = clip_id in registered_clips
        report_id   = str(uuid.uuid4())
        reported_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        dmca_reports.append({
            "id":             report_id,
            "clip_id":        clip_id,
            "clip_known":     clip_known,
            "infringing_url": infringing_url,
            "reporter_name":  reporter_name,
            "reporter_email": reporter_email,
            "status":         "pending",
            "reported_at":    reported_at,
        })

        logger.info(f"[DMCA] Report submitted — id={report_id} | url={infringing_url}")

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
        return jsonify({"success": False,
                        "message": f"Server error: {str(e)}", "data": None}), 500


@app.route("/compare", methods=["POST"])
def compare():
    """
    POST /compare  (v3 — accuracy engine)
    Directly compare two uploaded images.

    multipart/form-data:
      file_a (required) — first image  (jpg, jpeg, png)
      file_b (required) — second image (jpg, jpeg, png)

    Runs the full accuracy engine (crop, ORB, rotation, mirror, hash)
    on file_b against file_a as the reference.

    Response includes all v3 accuracy fields.
    """
    try:
        compare_start = time.time()

        # Load both images
        result_a = load_image_from_request("file_a")
        if result_a[2] is not None:
            return result_a[1], result_a[2]
        img_a, filename_a, _ = result_a

        result_b = load_image_from_request("file_b")
        if result_b[2] is not None:
            return result_b[1], result_b[2]
        img_b, filename_b, _ = result_b

        # Run the full accuracy engine: img_b = suspect, img_a = reference
        ref_hashes = compute_triple_hash(img_a)
        analysis   = run_full_analysis(img_b, img_a, ref_hashes)

        detection_time_ms = round((time.time() - compare_start) * 1000, 2)

        logger.info(
            f"[COMPARE] {filename_a} vs {filename_b} — "
            f"confidence={analysis['confidence']}% | verdict={analysis['verdict']}"
        )

        return jsonify({
            "success": True,
            "message": f"Comparison complete. Verdict: {analysis['verdict']}",
            "data": {
                "file_a": filename_a,
                "file_b": filename_b,

                # ── v3 accuracy fields ───────────────────────────────────
                "confidence":        analysis["confidence"],
                "hash_score":        analysis["hash_score"],
                "crop_score":        analysis["crop_score"],
                "orb_score":         analysis["orb_score"],
                "rotation_detected": analysis["rotation_detected"],
                "best_angle":        analysis["best_angle"],
                "mirror_detected":   analysis["mirror_detected"],
                "verdict":           analysis["verdict"],
                "confidence_band":   analysis["confidence_band"],

                # ── Detailed breakdown ───────────────────────────────────
                "detection_details": analysis["details"],

                "detection_time_ms": detection_time_ms,
            }
        }), 200

    except Exception as e:
        logger.error(f"[COMPARE] Unexpected error: {str(e)}")
        return jsonify({"success": False,
                        "message": f"Server error: {str(e)}", "data": None}), 500


# ─────────────────────────────────────────────
# Global Error Handlers
# ─────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({"success": False, "message": "Endpoint not found", "data": None}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"success": False, "message": "HTTP method not allowed", "data": None}), 405

@app.errorhandler(500)
def server_error(e):
    return jsonify({"success": False, "message": "Internal server error", "data": None}), 500


# ─────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 65)
    print("  Sports Guardian API v3.1.0  —  Starting up...")
    print("  Endpoints:")
    print("    GET  /health")
    print("    POST /register")
    print("    POST /scan     ← v3.1: 13-region crop + sliding window + ORB boost")
    print("    POST /dmca")
    print("    POST /compare  ← v3.1: full accuracy engine")
    print("=" * 65)
    app.run(debug=True, host="0.0.0.0", port=5000)
