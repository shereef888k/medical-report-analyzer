from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename
import os
import re
import pdfplumber
import pytesseract
from PIL import Image
import requests

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg"}

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024

# ---------------- ENV ----------------
OLLAMA_URL = os.getenv("OLLAMA_URL", "https://ollama.com")
OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY")

# ---------------- FILE CHECK ----------------
def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# ---------------- TEXT EXTRACTION ----------------
def extract_text_from_pdf(path):
    text = ""
    try:
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
        return text.strip()
    except Exception as e:
        return f"PDF read error: {e}"


def extract_text_from_image(path):
    try:
        img = Image.open(path)
        text = pytesseract.image_to_string(img)
        return text.strip()
    except Exception as e:
        return f"Image OCR error: {e}"


# ---------------- ANALYSIS ----------------
def analyze_report(text):
    results = []

    hb = re.search(r"Hemoglobin.*?(\d+\.?\d*)", text, re.IGNORECASE)
    if hb:
        value = float(hb.group(1))
        status = "LOW" if value < 13 else "HIGH" if value > 17 else "NORMAL"
        results.append({
            "test": "Hemoglobin",
            "value": value,
            "status": status,
            "normal_range": "13 - 17"
        })

    wbc = re.search(r"(?:WBC|Total\s+WBC\s+count).*?(\d+)", text, re.IGNORECASE)
    if wbc:
        value = float(wbc.group(1))
        status = "LOW" if value < 4000 else "HIGH" if value > 11000 else "NORMAL"
        results.append({
            "test": "WBC",
            "value": value,
            "status": status,
            "normal_range": "4000 - 11000"
        })

    platelets = re.search(r"(?:Platelet|Platelet\s+Count).*?(\d+)", text, re.IGNORECASE)
    if platelets:
        value = float(platelets.group(1))
        status = "LOW" if value < 150000 else "HIGH" if value > 410000 else "NORMAL"
        results.append({
            "test": "Platelets",
            "value": value,
            "status": status,
            "normal_range": "150000 - 410000"
        })

    return results


# ---------------- ANALYZE ROUTE ----------------
@app.route("/analyze", methods=["POST"])
def analyze():
    file = request.files.get("report")

    if not file or not file.filename:
        return jsonify({"error": "No file uploaded"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Unsupported file type"}), 400

    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    filename = secure_filename(file.filename)
    file_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    file.save(file_path)

    ext = filename.rsplit(".", 1)[1].lower()

    extracted_text = (
        extract_text_from_pdf(file_path)
        if ext == "pdf"
        else extract_text_from_image(file_path)
    )

    analysis = analyze_report(extracted_text)

    return jsonify({
        "filename": filename,
        "extracted_text": extracted_text,
        "analysis": analysis
    })


# ---------------- CHAT ROUTE (FIXED) ----------------
@app.route("/chat", methods=["POST"])
def chat():
    data = request.json
    question = data.get("question")
    report = data.get("report")

    if not question:
        return jsonify({"error": "No question provided"}), 400

    if not OLLAMA_API_KEY:
        return jsonify({"error": "Ollama API key not configured"}), 500

    prompt = f"""
    You are a medical assistant.
    Based on the report below, answer clearly.

    Report:
    {report}

    Question:
    {question}
    """

    try:
        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            headers={
                "Authorization": f"Bearer {OLLAMA_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "gpt-oss:20b",
                "prompt": prompt,
                "stream": False
            },
            timeout=60
        )

        result = response.json()
        return jsonify({
            "answer": result.get("response", "No response")
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------- HOME ----------------
@app.route("/")
def home():
    return jsonify({"message": "API running"})


if __name__ == "__main__":
    os.makedirs("uploads", exist_ok=True)
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)