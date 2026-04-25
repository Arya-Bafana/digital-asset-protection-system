from flask import Flask, request, jsonify
from flask_cors import CORS
import imagehash
from PIL import Image
import io, datetime

app = Flask(__name__)
CORS(app)

registered_clips = {}

@app.route('/register', methods=['POST'])
def register_clip():
    file = request.files.get('file')
    if not file:
        return jsonify({"error": "No file"}), 400
    img = Image.open(io.BytesIO(file.read())).convert('RGB')
    phash = str(imagehash.phash(img))
    clip_id = f"clip_{len(registered_clips)+1}"
    registered_clips[clip_id] = {"phash": phash, "name": file.filename}
    return jsonify({"success": True, "clip_id": clip_id, "fingerprint": phash})

@app.route('/scan', methods=['POST'])
def scan():
    results = [
        {"platform": "YouTube", "uploader": "@CricketHighlights99", "views": "2.4M", "confidence": 97},
        {"platform": "Instagram", "uploader": "@sports_reel_king", "views": "890K", "confidence": 94},
        {"platform": "Telegram", "uploader": "IPL_Leaks_2026", "views": "340K", "confidence": 91},
    ]
    return jsonify({"alerts": results, "time_taken": "8 seconds"})

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "running"})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
