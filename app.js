const API_BASE = "https://road-damage-api.lemoncoast-6fffcba2.uaenorth.azurecontainerapps.io";
const WS_URL = "wss://road-damage-api.lemoncoast-6fffcba2.uaenorth.azurecontainerapps.io/ws/live";

// ==========================================
// 1. Tab Switching & Shared UI Helpers
// ==========================================
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;

    // Stop live camera automatically if switching away from Live tab
    if (target !== "live" && liveRunning) {
      stopLiveStream();
    }

    tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
    tabPanels.forEach((p) => p.classList.toggle("active", p.id === `panel-${target}`));
    clearStatus();
  });
});

const statusBar = document.getElementById("status-bar");
const statusSpinner = document.getElementById("status-spinner");
const statusText = document.getElementById("status-text");

function setStatus(message, { loading = false, error = false } = {}) {
  statusBar.classList.remove("hidden", "error");
  if (error) statusBar.classList.add("error");
  statusSpinner.classList.toggle("hidden", !loading);
  statusText.textContent = message;
}

function clearStatus() {
  statusBar.classList.add("hidden");
}

function updateAnalytics({ counts = {}, fps = 0, road_condition = "Waiting" }) {
  const classes = ["D00", "D10", "D20", "D40"];
  let total = 0;

  classes.forEach((cls) => {
    const val = counts[cls] ?? 0;
    total += val;
    document.getElementById(`count-${cls}`).textContent = val;
  });

  document.getElementById("metric-total").textContent = total;
  document.getElementById("metric-fps").textContent = Number(fps || 0).toFixed(2);

  const badge = document.getElementById("condition-badge");
  badge.textContent = road_condition;
  badge.className = "badge";

  const key = String(road_condition).toLowerCase();
  if (key === "good" || key === "fair" || key === "dangerous") {
    badge.classList.add(key);
  } else {
    badge.classList.add("neutral");
  }
}

// ==========================================
// 2. Image Analysis (POST /predict/image)
// ==========================================
const imageInput = document.getElementById("image-input");
const imageFileName = document.getElementById("image-file-name");
const btnAnalyzeImage = document.getElementById("btn-analyze-image");
const imagePreview = document.getElementById("image-preview");
const imagePlaceholder = document.getElementById("image-placeholder");
const imageActions = document.getElementById("image-actions");
const imageDownload = document.getElementById("image-download");

let selectedImageFile = null;
let imageObjectUrl = null;

imageInput.addEventListener("change", () => {
  const file = imageInput.files[0];
  if (!file) return;

  if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
  imageObjectUrl = URL.createObjectURL(file);

  selectedImageFile = file;
  imageFileName.textContent = file.name;
  btnAnalyzeImage.disabled = false;

  imagePreview.src = imageObjectUrl;
  imagePreview.classList.remove("hidden");
  imagePlaceholder.classList.add("hidden");
  imageActions.classList.add("hidden");
  clearStatus();
});

btnAnalyzeImage.addEventListener("click", async () => {
  if (!selectedImageFile) return;

  const formData = new FormData();
  formData.append("file", selectedImageFile);

  btnAnalyzeImage.disabled = true;
  setStatus("Analyzing image on Azure (first request may take 20–30s on cold start)...", { loading: true });

  try {
    const res = await fetch(`${API_BASE}/predict/image`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `Server error (${res.status})`);
    }

    const data = await res.json();
    const annotatedUrl = `${API_BASE}${data.output_url}`;

    imagePreview.src = annotatedUrl;
    imageDownload.href = annotatedUrl;
    imageActions.classList.remove("hidden");

    updateAnalytics(data);
    clearStatus();
  } catch (err) {
    setStatus(`Image analysis failed: ${err.message}`, { error: true });
  } finally {
    btnAnalyzeImage.disabled = false;
  }
});

// ==========================================
// 3. Video Analysis (POST /predict/video)
// ==========================================
const videoInput = document.getElementById("video-input");
const videoFileName = document.getElementById("video-file-name");
const btnAnalyzeVideo = document.getElementById("btn-analyze-video");
const videoPreview = document.getElementById("video-preview");
const videoPlaceholder = document.getElementById("video-placeholder");
const videoActions = document.getElementById("video-actions");
const videoDownload = document.getElementById("video-download");
const framesInfo = document.getElementById("frames-info");

let selectedVideoFile = null;
let videoObjectUrl = null;

videoInput.addEventListener("change", () => {
  const file = videoInput.files[0];
  if (!file) return;

  if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
  videoObjectUrl = URL.createObjectURL(file);

  selectedVideoFile = file;
  videoFileName.textContent = file.name;
  btnAnalyzeVideo.disabled = false;

  videoPreview.src = videoObjectUrl;
  videoPreview.load();
  videoPreview.classList.remove("hidden");
  videoPlaceholder.classList.add("hidden");
  videoActions.classList.add("hidden");
  clearStatus();
});

btnAnalyzeVideo.addEventListener("click", async () => {
  if (!selectedVideoFile) return;

  const formData = new FormData();
  formData.append("file", selectedVideoFile);

  btnAnalyzeVideo.disabled = true;
  setStatus("Processing video on Azure CPU — this may take up to a few minutes depending on clip length...", { loading: true });

  try {
    const res = await fetch(`${API_BASE}/predict/video`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `Server error (${res.status})`);
    }

    const data = await res.json();
    const processedUrl = `${API_BASE}${data.video_url}`;

    videoPreview.src = processedUrl;
    videoPreview.load();
    videoDownload.href = processedUrl;
    framesInfo.textContent = `Frames processed: ${data.frames_processed ?? "-"}`;
    videoActions.classList.remove("hidden");

    updateAnalytics(data);
    clearStatus();
  } catch (err) {
    setStatus(`Video analysis failed: ${err.message}`, { error: true });
  } finally {
    btnAnalyzeVideo.disabled = false;
  }
});

// ==========================================
// 4. Live Camera Stream (WS /ws/live)
// ==========================================
const btnStartLive = document.getElementById("btn-start-live");
const btnStopLive = document.getElementById("btn-stop-live");
const liveOutput = document.getElementById("live-output");
const livePlaceholder = document.getElementById("live-placeholder");
const webcamVideo = document.getElementById("webcam");
const captureCanvas = document.getElementById("capture-canvas");
const captureCtx = captureCanvas.getContext("2d");

let ws = null;
let mediaStream = null;
let liveRunning = false;

function sendLiveFrame() {
  if (!liveRunning || !ws || ws.readyState !== WebSocket.OPEN) return;

  if (webcamVideo.readyState < 2 || webcamVideo.videoWidth === 0) {
    setTimeout(sendLiveFrame, 100);
    return;
  }

  captureCanvas.width = 640;
  captureCanvas.height = Math.round((webcamVideo.videoHeight / webcamVideo.videoWidth) * 640) || 480;
  captureCtx.drawImage(webcamVideo, 0, 0, captureCanvas.width, captureCanvas.height);

  captureCanvas.toBlob(
    async (blob) => {
      if (blob && liveRunning && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(await blob.arrayBuffer());
      }
    },
    "image/jpeg",
    0.7
  );
}

function stopLiveStream(keepStatus = false) {
  liveRunning = false;
  btnStartLive.disabled = false;
  btnStopLive.disabled = true;

  if (ws) {
    ws.onclose = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    ws = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  webcamVideo.srcObject = null;
  if (!keepStatus) clearStatus();
}

btnStartLive.addEventListener("click", async () => {
  try {
    btnStartLive.disabled = true;
    setStatus("Requesting camera access...", { loading: true });

    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    webcamVideo.srcObject = mediaStream;
    await webcamVideo.play();

    setStatus("Connecting to Azure live stream (cold start may take 20–30s)...", { loading: true });
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      liveRunning = true;
      btnStopLive.disabled = false;
      liveOutput.classList.remove("hidden");
      livePlaceholder.classList.add("hidden");
      setStatus("Live detection active", { loading: false });
      sendLiveFrame();
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.frame) {
        liveOutput.src = `data:image/jpeg;base64,${data.frame}`;
      }
      updateAnalytics(data);

      // Wait for each processed reply before sending the next frame
      if (liveRunning) {
        requestAnimationFrame(sendLiveFrame);
      }
    };

    ws.onerror = () => {
      setStatus("WebSocket connection error — verify the Azure container is running.", { error: true });
      stopLiveStream(true);
    };

    ws.onclose = () => {
      if (liveRunning) {
        setStatus("Live stream disconnected.", { error: true });
        stopLiveStream(true);
      }
    };
  } catch (err) {
    setStatus(`Camera error: ${err.message}`, { error: true });
    stopLiveStream(true);
  }
});

btnStopLive.addEventListener("click", () => stopLiveStream(false));