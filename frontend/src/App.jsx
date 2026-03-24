import { useRef, useState } from "react";
import "./App.css";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

function App() {
  const [file, setFile] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [question, setQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [isListening, setIsListening] = useState(false);

  const galleryInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);

  const quickQuestions = [
    "Is my report normal?",
    "What is wrong in my report?",
    "Do I have anemia?",
    "What should I do next?",
  ];

  const handleFileSelect = (selectedFile) => {
    if (!selectedFile) return;

    setFile(selectedFile);
    setData(null);
    setError("");
    setQuestion("");
    setChatError("");
    setChatHistory([]);
  };

  const handleUpload = async () => {
    if (!file) {
      alert("Please choose or capture a file first.");
      return;
    }

    const formData = new FormData();
    formData.append("report", file);

    try {
      setLoading(true);
      setError("");
      setData(null);
      setQuestion("");
      setChatError("");
      setChatHistory([]);

      const res = await fetch("http://127.0.0.1:5000/analyze", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();

      if (!res.ok) {
        setError(result.error || "Something went wrong.");
        return;
      }

      setData(result);
    } catch (err) {
      setError("Failed to connect to backend.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAsk = async (customQuestion = null) => {
    const finalQuestion = (customQuestion || question).trim();

    if (!finalQuestion) {
      alert("Please type a question first.");
      return;
    }

    if (!data?.extracted_text) {
      alert("Please analyze a report first.");
      return;
    }

    try {
      setChatLoading(true);
      setChatError("");

      const res = await fetch("http://127.0.0.1:5000/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: finalQuestion,
          report: data.extracted_text,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        setChatError(result.error || "Chat request failed.");
        return;
      }

      const newMessage = {
        question: finalQuestion,
        answer: result.answer || "No answer received.",
      };

      setChatHistory((prev) => [...prev, newMessage]);
      setQuestion("");
    } catch (err) {
      setChatError("Failed to connect to chat service.");
      console.error(err);
    } finally {
      setChatLoading(false);
    }
  };

  const handleVoiceInput = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setChatError("Voice input is not supported in this browser.");
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setChatError("");
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setQuestion(transcript);
    };

    recognition.onerror = (event) => {
      console.log("Voice error:", event.error);

      if (event.error === "not-allowed") {
        setChatError(
          "Microphone blocked. Please allow microphone access in your browser settings."
        );
      } else if (event.error === "no-speech") {
        setChatError("No speech detected. Please try again.");
      } else if (event.error === "audio-capture") {
        setChatError("Microphone not found.");
      } else if (event.error === "network") {
        setChatError("Voice service network error. Please try again.");
      } else {
        setChatError("Voice input error. Please try again.");
      }

      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const downloadPdf = () => {
    if (!data) {
      alert("Please analyze a report first.");
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(18);
    doc.text("Medical Report Analyzer", 14, 18);

    doc.setFontSize(11);
    doc.text(`File: ${data.filename || "N/A"}`, 14, 28);
    doc.text(`Risk Level: ${data.risk || "N/A"}`, 14, 35);

    let currentY = 44;

    if (data.insight) {
      doc.setFontSize(13);
      doc.text("Quick Insight", 14, currentY);
      currentY += 7;

      const insightLines = doc.splitTextToSize(data.insight, pageWidth - 28);
      doc.setFontSize(11);
      doc.text(insightLines, 14, currentY);
      currentY += insightLines.length * 6 + 4;
    }

    if (data.analysis && data.analysis.length > 0) {
      autoTable(doc, {
        startY: currentY,
        head: [["Test", "Value", "Normal Range", "Status"]],
        body: data.analysis.map((item) => [
          item.test,
          String(item.value),
          item.normal_range,
          item.status,
        ]),
        styles: {
          fontSize: 10,
        },
        headStyles: {
          fillColor: [59, 130, 246],
        },
      });

      currentY = doc.lastAutoTable.finalY + 10;
    }

    if (data.summary) {
      doc.setFontSize(13);
      doc.text("Summary", 14, currentY);
      currentY += 7;

      const summaryLines = doc.splitTextToSize(data.summary, pageWidth - 28);
      doc.setFontSize(11);
      doc.text(summaryLines, 14, currentY);
      currentY += summaryLines.length * 6 + 6;
    }

    if (data.suggestions && data.suggestions.length > 0) {
      doc.setFontSize(13);
      doc.text("Suggestions", 14, currentY);
      currentY += 7;

      doc.setFontSize(11);
      data.suggestions.forEach((item, index) => {
        const lines = doc.splitTextToSize(`• ${item}`, pageWidth - 28);
        doc.text(lines, 14, currentY);
        currentY += lines.length * 6 + (index === data.suggestions.length - 1 ? 0 : 2);
      });
      currentY += 6;
    }

    if (chatHistory.length > 0) {
      if (currentY > 240) {
        doc.addPage();
        currentY = 20;
      }

      doc.setFontSize(13);
      doc.text("Chat History", 14, currentY);
      currentY += 8;

      chatHistory.forEach((chat, index) => {
        const qLines = doc.splitTextToSize(`Q: ${chat.question}`, pageWidth - 28);
        const aLines = doc.splitTextToSize(`A: ${chat.answer}`, pageWidth - 28);

        if (currentY > 250) {
          doc.addPage();
          currentY = 20;
        }

        doc.setFontSize(11);
        doc.text(qLines, 14, currentY);
        currentY += qLines.length * 6 + 2;
        doc.text(aLines, 14, currentY);
        currentY += aLines.length * 6 + 6;

        if (index !== chatHistory.length - 1) {
          currentY += 2;
        }
      });
    }

    const safeName = (data.filename || "medical-report").replace(/\.[^/.]+$/, "");
    doc.save(`${safeName}-analysis.pdf`);
  };

  const getChartData = () => {
    if (!data || !data.analysis || data.analysis.length === 0) {
      return {
        labels: [],
        datasets: [],
      };
    }

    return {
      labels: data.analysis.map((item) => item.test),
      datasets: [
        {
          label: "Test Values",
          data: data.analysis.map((item) => item.value),
          backgroundColor: data.analysis.map((item) => {
            if (item.status === "LOW") return "#f87171";
            if (item.status === "HIGH") return "#facc15";
            return "#4ade80";
          }),
          borderRadius: 8,
        },
      ],
    };
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        labels: {
          color: "white",
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: "white",
        },
        grid: {
          color: "rgba(255,255,255,0.08)",
        },
      },
      y: {
        ticks: {
          color: "white",
        },
        grid: {
          color: "rgba(255,255,255,0.08)",
        },
      },
    },
  };

  return (
    <div className="container">
      <h1>Medical Report Analyzer</h1>

      <div className="card upload-card">
        <h2>Choose Report</h2>

        <div className="upload-actions">
          <button onClick={() => cameraInputRef.current?.click()}>
            Capture from Camera
          </button>
          <button onClick={() => galleryInputRef.current?.click()}>
            Choose Image
          </button>
          <button onClick={() => fileInputRef.current?.click()}>
            Upload PDF/File
          </button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden-input"
          onChange={(e) => handleFileSelect(e.target.files[0])}
        />

        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="hidden-input"
          onChange={(e) => handleFileSelect(e.target.files[0])}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/*"
          className="hidden-input"
          onChange={(e) => handleFileSelect(e.target.files[0])}
        />

        {file && (
          <div className="selected-file">
            <strong>Selected:</strong> {file.name}
          </div>
        )}

        <button className="analyze-btn" onClick={handleUpload}>
          {loading ? "Analyzing..." : "Analyze Report"}
        </button>
      </div>

      {error && (
        <div className="card error-card">
          <h2>Error</h2>
          <p>{error}</p>
        </div>
      )}

      {data && (
        <>
          <div className="card file-card">
            <div>
              <h2>File Details</h2>
              <p><strong>File:</strong> {data.filename}</p>
              <p>
                <strong>Risk Level:</strong>{" "}
                <span className={`risk ${data.risk?.toLowerCase()}`}>
                  {data.risk}
                </span>
              </p>
            </div>

            <button className="download-btn" onClick={downloadPdf}>
              Download PDF
            </button>
          </div>

          {data.insight && (
            <div className="card">
              <h2>Quick Insight</h2>
              <p>{data.insight}</p>
            </div>
          )}

          {data.analysis && data.analysis.length > 0 && (
            <div className="card">
              <h2>Analysis</h2>
              <table>
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Value</th>
                    <th>Normal Range</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.analysis.map((item, i) => (
                    <tr key={i}>
                      <td>{item.test}</td>
                      <td>{item.value}</td>
                      <td>{item.normal_range}</td>
                      <td>
                        <span className={`badge ${item.status.toLowerCase()}`}>
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.analysis && data.analysis.length > 0 && (
            <div className="card">
              <h2>Report Visualization</h2>
              <Bar data={getChartData()} options={chartOptions} />
            </div>
          )}

          {data.summary && (
            <div className="card">
              <h2>Summary</h2>
              <p>{data.summary}</p>
            </div>
          )}

          {data.suggestions && data.suggestions.length > 0 && (
            <div className="card">
              <h2>Suggestions</h2>
              <ul>
                {data.suggestions.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="card">
            <h2>Chat with Report</h2>

            <div className="quick-questions">
              {quickQuestions.map((q, i) => (
                <button
                  key={i}
                  className="chip"
                  onClick={() => handleAsk(q)}
                  disabled={chatLoading}
                >
                  {q}
                </button>
              ))}
            </div>

            <div className="chat-box">
              <input
                type="text"
                className="chat-input"
                placeholder="Ask something about your report..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAsk();
                }}
              />
              <button
                onClick={handleVoiceInput}
                className={isListening ? "mic-btn listening" : "mic-btn"}
              >
                {isListening ? "🎙️ Listening..." : "🎤 Speak"}
              </button>
              <button onClick={() => handleAsk()}>
                {chatLoading ? "Thinking..." : "Ask"}
              </button>
            </div>

            {chatError && (
              <div className="chat-error">
                <p>{chatError}</p>
              </div>
            )}

            {chatHistory.length > 0 && (
              <div className="chat-history">
                {chatHistory.map((item, index) => (
                  <div key={index} className="chat-message">
                    <div className="question-bubble">
                      <strong>You:</strong> {item.question}
                    </div>
                    <div className="answer-bubble">
                      <strong>AI:</strong> {item.answer}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {data.extracted_text && (
            <div className="card">
              <h2>Extracted Text</h2>
              <p>{data.extracted_text}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;