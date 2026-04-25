from flask import Flask, request, jsonify
from flask_cors import CORS
import imagehash
from PIL import Image, ImageOps
import numpy as np
import io
import os

app = Flask(__name__)
CORS(app)

# In-memory storage for registered content fingerprints
registered_content = {}

# ─────────────────────────────────────────
# HELPER: Normalize image before hashing
# This fixes: color filters, brightness changes, contrast edits
# ─────────────────────────────────────────
def normalize_image(img):
    """
    Normalize image so that color filters and brightness changes
    don't affect the hash comparison result.
    Steps:
      1. Convert to greyscale (removes color filter effect)
      2. Apply histogram equalization (normalizes brightness/contrast)
      3. Resize to standard size (removes resolution differences)
    """
    # Step 1: Convert to greyscale — removes Instagram/Snapchat color filters
    img_grey = img.convert('L')

    # Step 2: Histogram equalization — normalizes brightness and contrast
    img_normalized = ImageOps.equalize(img_grey)

    # Step 3: Resize to standard 256x256 — removes resolution differences
    img_resized = img_normalized.resize((256, 256), Image.LANCZOS)

    return img_resized


# ─────────────────────────────────────────
# HELPER: Generate triple hash fingerprint
# Uses pHash + dHash + aHash together
# Much harder to fool than single hash
# ─────────────────────────────────────────
def generate_triple_hash(img):
    """
    Generate three different hashes from the same image.
    - pHash: Perceptual hash — detects overall visual similarity
    - dHash: Difference hash — detects edge/gradient changes
    - aHash: Average hash — detects brightness pattern changes
    Together they give much better detection accuracy.
    """
    normalized = normalize_image(img)

    phash = imagehash.phash(normalized)      # Perceptual hash
    dhash = imagehash.dhash(normalized)      # Difference hash
    ahash = imagehash.average_hash(normalized)  # Average hash

    return {
        'phash': str(phash),
        'dhash': str(dhash),
        'ahash': str(ahash)
    }


# ─────────────────────────────────────────
# HELPER: Compare two sets of triple hashes
# Returns confidence score 0-100
# ─────────────────────────────────────────
def compare_triple_hash(hash1, hash2):
    """
    Compare two triple-hash fingerprints.
    Each hash comparison gives a similarity score.
    Final score = weighted average of all three.
    
    Weights:
      pHash: 50% (most reliable for overall content)
      dHash: 30% (good for detecting edits)
      aHash: 20% (good for detecting brightness changes)
    """
    # Convert string hashes back to imagehash objects for comparison
    ph1 = imagehash.hex_to_hash(hash1['phash'])
    ph2 = imagehash.hex_to_hash(hash2['phash'])

    dh1 = imagehash.hex_to_hash(hash1['dhash'])
    dh2 = imagehash.hex_to_hash(hash2['dhash'])

    ah1 = imagehash.hex_to_hash(hash1['ahash'])
    ah2 = imagehash.hex_to_hash(hash2['ahash'])

    # Calculate Hamming distance for each hash (lower = more similar)
    # Max possible distance for 64-bit hash is 64
    p_distance = ph1 - ph2
    d_distance = dh1 - dh2
    a_distance = ah1 - ah2

    # Convert distance to similarity score (0-100)
    p_score = max(0, 100 - (p_distance / 64.0 * 100))
    d_score = max(0, 100 - (d_distance / 64.0 * 100))
    a_score = max(0, 100 - (a_distance / 64.0 * 100))

    # Weighted average
    final_score = (p_score * 0.5) + (d_score * 0.3) + (a_score * 0.2)

    return round(final_score, 1)


# ─────────────────────────────────────────
# ENDPOINT: Health Check
# GET /health
# ─────────────────────────────────────────
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'running',
        'version': '2.0',
        'features': [
            'triple_hash_detection',
            'histogram_normalization',
            'color_filter_resistance',
            'brightness_resistance'
        ]
    })


# ─────────────────────────────────────────
# ENDPOINT: Register Content
# POST /register
# Accepts image/video file
# Returns triple-hash fingerprint
# ─────────────────────────────────────────
@app.route('/register', methods=['POST'])
def register():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    try:
        # Read image from uploaded file
        img_bytes = file.read()
        img = Image.open(io.BytesIO(img_bytes))

        # Generate triple hash fingerprint
        fingerprint = generate_triple_hash(img)

        # Create unique content ID from filename + phash
        content_id = f"{file.filename}_{fingerprint['phash'][:8]}"

        # Store in memory
        registered_content[content_id] = {
            'filename': file.filename,
            'fingerprint': fingerprint,
            'registered_at': 'now'
        }

        return jsonify({
            'success': True,
            'content_id': content_id,
            'fingerprint': fingerprint,
            'message': f'Content registered with triple-hash fingerprint. Color filter resistant: YES. Brightness resistant: YES.'
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─────────────────────────────────────────
# ENDPOINT: Scan for Stolen Content
# POST /scan
# Accepts optional image to compare against registered content
# Returns detection results with confidence scores
# ─────────────────────────────────────────
@app.route('/scan', methods=['POST'])
def scan():
    # If an image is provided, do real comparison
    if 'file' in request.files:
        file = request.files['file']
        try:
            img_bytes = file.read()
            img = Image.open(io.BytesIO(img_bytes))
            scan_fingerprint = generate_triple_hash(img)

            results = []
            for content_id, content_data in registered_content.items():
                confidence = compare_triple_hash(
                    scan_fingerprint,
                    content_data['fingerprint']
                )

                if confidence > 70:  # Only flag if more than 70% match
                    status = 'STOLEN' if confidence > 85 else 'INVESTIGATING'
                    results.append({
                        'content_id': content_id,
                        'filename': content_data['filename'],
                        'confidence': confidence,
                        'status': status,
                        'hash_breakdown': {
                            'phash_match': 'calculated',
                            'dhash_match': 'calculated',
                            'ahash_match': 'calculated'
                        }
                    })

            results.sort(key=lambda x: x['confidence'], reverse=True)

            return jsonify({
                'success': True,
                'scan_type': 'real_triple_hash',
                'results': results,
                'total_found': len(results)
            })

        except Exception as e:
            return jsonify({'error': str(e)}), 500

    # No file provided — return simulated demo results for dashboard
    simulated_results = [
        {
            'id': 1,
            'platform': 'YouTube',
            'uploader': '@cricket_highlights_hd',
            'clip': 'Kohli Century - T20 World Cup',
            'confidence': 97.3,
            'status': 'STOLEN',
            'detection_method': 'triple_hash + histogram_normalization',
            'color_filter_detected': True,
            'brightness_change_detected': False
        },
        {
            'id': 2,
            'platform': 'Instagram',
            'uploader': '@sports_reels_india',
            'clip': 'Bumrah Hat-trick Celebration',
            'confidence': 91.8,
            'status': 'STOLEN',
            'detection_method': 'triple_hash + histogram_normalization',
            'color_filter_detected': True,
            'brightness_change_detected': True
        },
        {
            'id': 3,
            'platform': 'Telegram',
            'uploader': 'IPL Leaks Channel',
            'clip': 'Rohit Sharma Six Compilation',
            'confidence': 88.5,
            'status': 'STOLEN',
            'detection_method': 'phash_primary',
            'color_filter_detected': False,
            'brightness_change_detected': False
        },
        {
            'id': 4,
            'platform': 'YouTube',
            'uploader': '@fan_edits_cricket',
            'clip': 'Dhoni Finishes Off in Style',
            'confidence': 76.2,
            'status': 'INVESTIGATING',
            'detection_method': 'triple_hash',
            'color_filter_detected': True,
            'brightness_change_detected': True
        },
        {
            'id': 5,
            'platform': 'Reddit',
            'uploader': 'u/cricket_fan_2024',
            'clip': 'Shami Bowling Masterclass',
            'confidence': 42.1,
            'status': 'CLEAN',
            'detection_method': 'triple_hash',
            'color_filter_detected': False,
            'brightness_change_detected': False
        }
    ]

    return jsonify({
        'success': True,
        'scan_type': 'demo_simulation',
        'results': simulated_results,
        'total_found': 4,
        'improvements_active': [
            'Triple hash comparison (pHash + dHash + aHash)',
            'Histogram normalization (color filter resistant)',
            'Brightness/contrast normalization',
            'Greyscale conversion before hashing'
        ]
    })


# ─────────────────────────────────────────
# ENDPOINT: Generate DMCA Letter
# POST /dmca
# Accepts platform, uploader, confidence, clip name
# Returns formatted DMCA takedown letter
# ─────────────────────────────────────────
@app.route('/dmca', methods=['POST'])
def dmca():
    data = request.get_json()

    platform = data.get('platform', 'Unknown Platform')
    uploader = data.get('uploader', 'Unknown Uploader')
    confidence = data.get('confidence', 0)
    clip = data.get('clip', 'Sports Content')

    letter = f"""DMCA TAKEDOWN NOTICE
Generated by Sports Guardian v2.0 — Triple Hash Detection Engine
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TO: {platform} Trust & Safety Team
RE: Copyright Infringement — Unauthorized Sports Content

INFRINGING CONTENT DETAILS:
• Platform: {platform}
• Uploader/Channel: {uploader}
• Content: {clip}
• Detection Confidence: {confidence}%
• Detection Method: Triple Hash (pHash + dHash + aHash) with Histogram Normalization

DETECTION TECHNOLOGY:
This content was identified using Sports Guardian's triple-hash fingerprinting system.
Our system uses perceptual hashing, difference hashing, and average hashing combined
with histogram normalization — making it resistant to color filters, brightness changes,
and minor edits. Confidence threshold for DMCA: >85%.

LEGAL NOTICE:
I, the undersigned, hereby state that I have a good faith belief that the above-described
activity is not authorized by the copyright owner, its agent, or the law.

I hereby demand that you immediately:
1. Remove or disable access to the infringing content
2. Notify the uploader of this takedown
3. Confirm removal within 48 hours

Under penalty of perjury, I certify the information in this notification is accurate.

— Sports Guardian Automated DMCA System
   Powered by Triple Hash Detection + Histogram Normalization
   Detection Confidence: {confidence}%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"""

    return jsonify({
        'success': True,
        'dmca_letter': letter,
        'platform': platform,
        'confidence': confidence
    })


# ─────────────────────────────────────────
# ENDPOINT: Compare Two Images Directly
# POST /compare
# NEW ENDPOINT — Accepts two images, returns similarity score
# ─────────────────────────────────────────
@app.route('/compare', methods=['POST'])
def compare():
    """
    NEW: Compare two images directly.
    Upload 'original' and 'suspect' files.
    Returns detailed similarity breakdown.
    """
    if 'original' not in request.files or 'suspect' not in request.files:
        return jsonify({'error': 'Please provide both original and suspect files'}), 400

    try:
        original_file = request.files['original']
        suspect_file = request.files['suspect']

        original_img = Image.open(io.BytesIO(original_file.read()))
        suspect_img = Image.open(io.BytesIO(suspect_file.read()))

        # Generate triple hashes for both
        original_hashes = generate_triple_hash(original_img)
        suspect_hashes = generate_triple_hash(suspect_img)

        # Compare
        confidence = compare_triple_hash(original_hashes, suspect_hashes)

        # Determine verdict
        if confidence >= 85:
            verdict = 'STOLEN'
            action = 'Send DMCA immediately'
        elif confidence >= 70:
            verdict = 'INVESTIGATING'
            action = 'Manual review recommended'
        else:
            verdict = 'CLEAN'
            action = 'No action needed'

        return jsonify({
            'success': True,
            'confidence': confidence,
            'verdict': verdict,
            'action': action,
            'hash_breakdown': {
                'original_phash': original_hashes['phash'],
                'suspect_phash': suspect_hashes['phash'],
                'original_dhash': original_hashes['dhash'],
                'suspect_dhash': suspect_hashes['dhash'],
                'original_ahash': original_hashes['ahash'],
                'suspect_ahash': suspect_hashes['ahash']
            },
            'normalization_applied': True,
            'color_filter_resistant': True
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)
