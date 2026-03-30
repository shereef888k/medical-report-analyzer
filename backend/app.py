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

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


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


# ---------------- SUMMARY ----------------
def generate_summary(analysis):
    if not analysis:
        return "No important values detected."

    abnormal = [i for i in analysis if i["status"] != "NORMAL"]

    if not abnormal:
        return "All major values are within normal range."

    parts = []

    for item in abnormal:
        if item["test"] == "Hemoglobin" and item["status"] == "LOW":
            parts.append("Low hemoglobin detected (possible anemia).")
        elif item["test"] == "WBC" and item["status"] == "HIGH":
            parts.append("Elevated WBC count (possible infection).")
        elif item["test"] == "Platelets" and item["status"] == "LOW":
            parts.append("Low platelet count detected.")

    return " ".join(parts)


# ---------------- SUGGESTIONS ----------------
def generate_suggestions(analysis):
    suggestions = []

    for item in analysis:
        if item["test"] == "Hemoglobin" and item["status"] == "LOW":
            suggestions.append("Check iron levels and consult a doctor.")

        if item["test"] == "WBC" and item["status"] == "HIGH":
            suggestions.append("Possible infection. Medical review recommended.")

        if item["test"] == "Platelets" and item["status"] == "LOW":
            suggestions.append("Monitor for bleeding and consult a doctor.")

    if not suggestions:
        suggestions.append("No immediate concerns detected.")

    return suggestions


# ---------------- RISK ----------------
def generate_risk_level(analysis):
    risk = "LOW"

    for item in analysis:
        if item["status"] != "NORMAL":
            risk = "MEDIUM"

        if item["test"] == "WBC" and item["status"] == "HIGH":
            risk = "HIGH"

        if item["test"] == "Platelets" and item["status"] == "LOW":
            risk = "HIGH"

    return risk


# ---------------- INSIGHT ----------------
def generate_insight(analysis):
    abnormal = [i for i in analysis if i["status"] != "NORMAL"]

    if not abnormal:
        return "No major health concerns detected."

    return f"{len(abnormal)} abnormal value(s) detected. Review recommended."


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
    summary = generate_summary(analysis)
    suggestions = generate_suggestions(analysis)
    risk = generate_risk_level(analysis)
    insight = generate_insight(analysis)

    return jsonify({
        "filename": filename,
        "extracted_text": extracted_text,
        "analysis": analysis,
        "summary": summary,
        "suggestions": suggestions,
        "risk": risk,
        "insight": insight
    })


# ---------------- CHAT ROUTE ----------------
@app.route("/chat", methods=["POST"])
def chat():
    data = request.json
    question = data.get("question")
    report = data.get("report")

    if not question:
        return jsonify({"error": "No question provided"}), 400

    try:
        response = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": "phi3",
                "prompt": f"""
You are a medical assistant.

Report:
{report}

Question:
{question}

Give a short, clear answer.
""",
                "stream": False
            }
        )

        result = response.json()
        return jsonify({"answer": result.get("response", "")})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------- HOME ----------------
@app.route("/")
def home():
    return jsonify({"message": "API running"})


if __name__ == "__main__":
    import os
    os.makedirs("uploads", exist_ok=True)
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)