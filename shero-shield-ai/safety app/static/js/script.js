let sosTimer;
let countdown = 5;
let isAlertCancelled = false;

let audioRecorder;
let audioChunks = [];
let videoRecorder;
let videoChunks = [];
let videoStream;

let trackingTimer;
let motionCooldownUntil = 0;
let pendingThreatLevel = "high";

let systemConfig = {
  trigger_keyword: "help",
  shake_sensitivity: 35,
  silent_mode: false,
  live_tracking: false,
  tracking_interval: 30,
  geofencing_enabled: false,
  check_in_interval: 60,
  battery_alert_threshold: 20,
  quick_dial_number: "100",
};

function setStatus(text) {
  const el = document.getElementById("status-log");
  if (el) el.innerText = text;
}

function updateBadges() {
  const silentStatus = document.getElementById("silent-status");
  if (silentStatus) silentStatus.innerText = systemConfig.silent_mode ? "Silent" : "Normal";
  const trackingStatus = document.getElementById("tracking-status");
  if (trackingStatus) trackingStatus.innerText = systemConfig.live_tracking ? "Tracking On" : "Tracking Off";
}

// --- Modals ---
function toggleSettings() {
  const m = document.getElementById("settings-modal");
  m.style.display = m.style.display === "none" ? "flex" : "none";
}

function toggleContacts() {
  const m = document.getElementById("contacts-modal");
  m.style.display = m.style.display === "none" ? "flex" : "none";
  if (m.style.display === "flex") refreshContacts();
}

function toggleSafeZones() {
  const m = document.getElementById("safezone-modal");
  m.style.display = m.style.display === "none" ? "flex" : "none";
  if (m.style.display === "flex") refreshSafeZones();
}

function manageSafeZones() {
  toggleSafeZones();
}

function toggleThreatSelector() {
  const m = document.getElementById("threat-selector");
  m.style.display = m.style.display === "none" ? "flex" : "none";
}

function toggleLogs() {
  const m = document.getElementById("logs-panel");
  m.style.display = m.style.display === "none" ? "flex" : "none";
  if (m.style.display === "flex") fetchLogs();
}

function toggleLocationHistory() {
  const m = document.getElementById("location-panel");
  m.style.display = m.style.display === "none" ? "flex" : "none";
  if (m.style.display === "flex") fetchLocationHistory();
}

function viewLocationHistory() {
  const m = document.getElementById("location-panel");
  if (m.style.display !== "flex") m.style.display = "flex";
  fetchLocationHistory();
}

// --- Init ---
async function loadConfig() {
  try {
    const r = await fetch("/get_config");
    const data = await r.json();
    if (data && data.config) systemConfig = { ...systemConfig, ...data.config };

    // Populate settings UI
    const kw = document.getElementById("keyword-input");
    if (kw) kw.value = systemConfig.trigger_keyword || "help";
    const sens = document.getElementById("sensitivity-range");
    if (sens) sens.value = systemConfig.shake_sensitivity ?? 35;
    const sensVal = document.getElementById("sensitivity-value");
    if (sensVal) sensVal.innerText = String(sens?.value ?? systemConfig.shake_sensitivity ?? 35);

    const silent = document.getElementById("silent-mode");
    if (silent) silent.checked = !!systemConfig.silent_mode;
    const track = document.getElementById("live-tracking");
    if (track) track.checked = !!systemConfig.live_tracking;
    const geofence = document.getElementById("geofencing");
    if (geofence) geofence.checked = !!systemConfig.geofencing_enabled;

    const ti = document.getElementById("tracking-interval");
    if (ti) ti.value = systemConfig.tracking_interval ?? 30;
    const ci = document.getElementById("checkin-interval");
    if (ci) ci.value = systemConfig.check_in_interval ?? 60;
    const bt = document.getElementById("battery-threshold");
    if (bt) bt.value = systemConfig.battery_alert_threshold ?? 20;
    const qd = document.getElementById("quick-dial-number");
    if (qd) qd.value = systemConfig.quick_dial_number || "100";

    updateBadges();
    updateTrackingLoop();
  } catch (e) {
    console.warn("Failed to load config", e);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const sens = document.getElementById("sensitivity-range");
  if (sens) {
    sens.addEventListener("input", () => {
      const sensVal = document.getElementById("sensitivity-value");
      if (sensVal) sensVal.innerText = sens.value;
    });
  }

  const live = document.getElementById("live-tracking");
  if (live) {
    live.addEventListener("change", () => {
      systemConfig.live_tracking = !!live.checked;
      applyLiveTracking(systemConfig.live_tracking);
    });
  }

  const ti = document.getElementById("tracking-interval");
  if (ti) {
    ti.addEventListener("change", () => {
      systemConfig.tracking_interval = parseInt(ti.value || "30", 10);
      if (systemConfig.live_tracking) updateTrackingLoop();
    });
  }

  loadConfig();
  startVoiceRecognition();
});

async function applyLiveTracking(enabled) {
  try {
    await fetch("/toggle_tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  } catch (e) {}
  updateBadges();
  updateTrackingLoop();
  if (enabled) setStatus("📍 Live tracking enabled.");
  else setStatus("📍 Live tracking disabled.");
}

// --- Settings Save ---
async function saveSettings() {
  systemConfig.trigger_keyword = (document.getElementById("keyword-input")?.value || "help").toLowerCase();
  systemConfig.shake_sensitivity = parseInt(document.getElementById("sensitivity-range")?.value || "35", 10);
  systemConfig.silent_mode = !!document.getElementById("silent-mode")?.checked;
  systemConfig.live_tracking = !!document.getElementById("live-tracking")?.checked;
  systemConfig.tracking_interval = parseInt(document.getElementById("tracking-interval")?.value || "30", 10);
  systemConfig.check_in_interval = parseInt(document.getElementById("checkin-interval")?.value || "60", 10);
  systemConfig.battery_alert_threshold = parseInt(document.getElementById("battery-threshold")?.value || "20", 10);
  systemConfig.geofencing_enabled = !!document.getElementById("geofencing")?.checked;
  systemConfig.quick_dial_number = (document.getElementById("quick-dial-number")?.value || "100").trim();

  await fetch("/update_settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      keyword: systemConfig.trigger_keyword,
      sensitivity: systemConfig.shake_sensitivity,
      silent_mode: systemConfig.silent_mode,
      live_tracking: systemConfig.live_tracking,
      tracking_interval: systemConfig.tracking_interval,
      check_in_interval: systemConfig.check_in_interval,
      battery_threshold: systemConfig.battery_alert_threshold,
      geofencing_enabled: systemConfig.geofencing_enabled,
      quick_dial_number: systemConfig.quick_dial_number,
    }),
  });

  await applyLiveTracking(systemConfig.live_tracking);

  updateBadges();
  toggleSettings();
  alert("System Updated Successfully!");
}

// --- Contacts ---
async function refreshContacts() {
  const list = document.getElementById("contacts-list");
  if (list) list.innerHTML = "Loading contacts...";
  const r = await fetch("/manage_contacts");
  const contacts = await r.json();
  if (document.getElementById("contact-count")) document.getElementById("contact-count").innerText = String(contacts.length);
  if (!list) return;
  if (!contacts.length) {
    list.innerHTML = "<div class='log-item'>No contacts saved.</div>";
    return;
  }
  list.innerHTML = contacts
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .map(
      (c, idx) => `
        <div class="log-item">
          <b>${escapeHtml(c.name || "Contact")}</b><br>
          ${escapeHtml(c.number || "")} <span style="opacity:.7">(priority ${escapeHtml(String(c.priority ?? 99))})</span>
          <div style="margin-top:8px;">
            <button class="btn-secondary" onclick="deleteContact(${idx})">🗑️ Remove</button>
          </div>
        </div>
      `
    )
    .join("");
}

async function addContact() {
  const name = (document.getElementById("contact-name")?.value || "").trim();
  const number = (document.getElementById("contact-number")?.value || "").trim();
  const priority = parseInt(document.getElementById("contact-priority")?.value || "99", 10);
  if (!number) return alert("Please enter a phone number.");
  await fetch("/manage_contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name || "Contact", number, priority }),
  });
  document.getElementById("contact-name").value = "";
  document.getElementById("contact-number").value = "";
  document.getElementById("contact-priority").value = "1";
  refreshContacts();
}

async function deleteContact(index) {
  await fetch("/manage_contacts", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index }),
  });
  refreshContacts();
}

// --- Safe Zones ---
async function refreshSafeZones() {
  const list = document.getElementById("safezone-list");
  if (list) list.innerHTML = "Loading safe zones...";
  const r = await fetch("/get_safe_zones");
  const zones = await r.json();
  if (!list) return;
  if (!zones.length) {
    list.innerHTML = "<div class='log-item'>No safe zones yet. Add one using your current location.</div>";
    return;
  }
  list.innerHTML = zones
    .map(
      (z, idx) => `
        <div class="log-item">
          <b>${escapeHtml(z.name || "Safe Zone")}</b><br>
          Radius: ${escapeHtml(String(z.radius))}m<br>
          Lat/Lon: ${escapeHtml(String(z.lat))}, ${escapeHtml(String(z.lon))}
          <div style="margin-top:8px;">
            <button class="btn-secondary" onclick="deleteSafeZone(${idx})">🗑️ Delete</button>
          </div>
        </div>
      `
    )
    .join("");
}

async function addCurrentLocationAsZone() {
  const name = (document.getElementById("zone-name")?.value || "").trim() || "Safe Zone";
  const radius = parseFloat(document.getElementById("zone-radius")?.value || "500");
  if (!navigator.geolocation) return alert("Geolocation is not available.");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      await fetch("/add_safe_zone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          radius: isFinite(radius) ? radius : 500,
        }),
      });
      document.getElementById("zone-name").value = "";
      refreshSafeZones();
    },
    () => alert("Location permission denied.")
  );
}

async function deleteSafeZone(index) {
  await fetch("/delete_safe_zone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index }),
  });
  refreshSafeZones();
}

// --- Check-in ---
async function startCheckIn() {
  const ci = parseInt(document.getElementById("checkin-interval")?.value || "60", 10);
  await fetch("/update_settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ check_in_interval: ci }),
  });
  await fetch("/check_in", { method: "POST" });
  alert("Check-in enabled. Tap again anytime to reset the timer.");
}

// --- Emergency / Threat selection ---
function triggerWithThreat(level) {
  pendingThreatLevel = level;
  toggleThreatSelector();
  startEmergencySequence("Manual Button", level);
}

function startEmergencySequence(source, threatLevel = "high") {
  isAlertCancelled = false;
  countdown = 5;
  pendingThreatLevel = threatLevel || "high";
  document.getElementById("timer").innerText = String(countdown);
  document.getElementById("cancel-zone").style.display = "block";

  clearInterval(sosTimer);
  sosTimer = setInterval(() => {
    countdown--;
    document.getElementById("timer").innerText = String(countdown);
    if (countdown <= 0) {
      clearInterval(sosTimer);
      if (!isAlertCancelled) triggerSOS(source, pendingThreatLevel);
      document.getElementById("cancel-zone").style.display = "none";
    }
  }, 1000);
}

function cancelAlert() {
  isAlertCancelled = true;
  clearInterval(sosTimer);
  document.getElementById("cancel-zone").style.display = "none";
  setStatus("Alert cancelled.");
}

function triggerSOS(source, threatLevel = "high") {
  setStatus("🚨 Alert dispatched (sending evidence + location)...");
  document.querySelectorAll(".auth-box").forEach((b) => b.classList.add("alert-on"));

  capturePhoto();
  captureAudio();

  if (!navigator.geolocation) return setStatus("Geolocation unavailable.");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      await fetch("/trigger_sos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          source,
          threat_level: threatLevel,
        }),
      });
      setStatus("🚨 SOS sent. Live tracking will continue if enabled.");
    },
    () => setStatus("Location permission denied.")
  );
}

// --- Voice Recognition ---
function startVoiceRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  try {
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1][0].transcript.toLowerCase();
      if (last.includes((systemConfig.trigger_keyword || "help").toLowerCase())) {
        startEmergencySequence("Voice Trigger", "high");
      }
    };
    recognition.onerror = () => {};
    recognition.onend = () => {
      // Keep it running when possible
      try {
        recognition.start();
      } catch (e) {}
    };
    recognition.start();
  } catch (e) {}
}

// --- Motion / Shake detection ---
window.ondevicemotion = (e) => {
  const now = Date.now();
  if (now < motionCooldownUntil) return;
  const acc = e.accelerationIncludingGravity;
  if (!acc) return;
  const mag = Math.max(Math.abs(acc.x || 0), Math.abs(acc.y || 0), Math.abs(acc.z || 0));
  if (mag > (systemConfig.shake_sensitivity ?? 35)) {
    motionCooldownUntil = now + 8000;
    startEmergencySequence("Shake Detected", "high");
  }
};

// --- Live Tracking loop (frontend pushes location) ---
function updateTrackingLoop() {
  if (trackingTimer) clearInterval(trackingTimer);
  if (!systemConfig.live_tracking) return;
  const intervalMs = Math.max(5, parseInt(systemConfig.tracking_interval || 30, 10)) * 1000;
  trackingTimer = setInterval(pushLocationUpdate, intervalMs);
  pushLocationUpdate();
}

async function getBatteryLevel() {
  try {
    if (!navigator.getBattery) return null;
    const b = await navigator.getBattery();
    return Math.round((b.level ?? 1) * 100);
  } catch (e) {
    return null;
  }
}

async function pushLocationUpdate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const battery = await getBatteryLevel();
      if (battery != null && document.getElementById("battery-level")) {
        document.getElementById("battery-level").innerText = String(battery);
      }
      await fetch("/update_location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          battery: battery ?? 100,
        }),
      });
    },
    () => {}
  );
}

// --- Evidence ---
async function capturePhoto() {
  const video = document.getElementById("webcam");
  const canvas = document.getElementById("canvas");
  if (!video || !canvas) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    await new Promise((r) => setTimeout(r, 1200));
    const ctx = canvas.getContext("2d");
    canvas.width = 480;
    canvas.height = 320;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const fd = new FormData();
      fd.append("photo", blob, "capture.jpg");
      await fetch("/upload_evidence", { method: "POST", body: fd });
    }, "image/jpeg", 0.9);
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) {
    console.warn("Camera access denied");
  }
}

async function captureAudio() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioRecorder = new MediaRecorder(stream);
    audioChunks = [];
    audioRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    audioRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: "audio/webm" });
      const fd = new FormData();
      fd.append("audio", blob, "audio.webm");
      await fetch("/upload_evidence", { method: "POST", body: fd });
      stream.getTracks().forEach((t) => t.stop());
    };
    audioRecorder.start();
    setTimeout(() => {
      try {
        audioRecorder.stop();
      } catch (e) {}
    }, 5000);
  } catch (e) {
    console.warn("Mic access denied");
  }
}

async function startVideoRecording() {
  const btn = document.getElementById("video-btn");
  if (videoRecorder && videoRecorder.state === "recording") {
    try {
      videoRecorder.stop();
    } catch (e) {}
    return;
  }
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    videoRecorder = new MediaRecorder(videoStream, { mimeType: "video/webm" });
    videoChunks = [];
    if (btn) btn.innerText = "⏹ Stop Recording";
    videoRecorder.ondataavailable = (e) => videoChunks.push(e.data);
    videoRecorder.onstop = async () => {
      const blob = new Blob(videoChunks, { type: "video/webm" });
      const fd = new FormData();
      fd.append("video", blob, "video.webm");
      await fetch("/upload_evidence", { method: "POST", body: fd });
      if (btn) btn.innerText = "🎥 Record Video";
      if (videoStream) videoStream.getTracks().forEach((t) => t.stop());
      setStatus("🎥 Video saved as evidence.");
    };
    videoRecorder.start();
    setStatus("🎥 Recording video evidence...");
    setTimeout(() => {
      try {
        if (videoRecorder && videoRecorder.state === "recording") videoRecorder.stop();
      } catch (e) {}
    }, 10000);
  } catch (e) {
    alert("Camera/microphone permission required for video evidence.");
  }
}

// --- Logs / Location history ---
async function fetchLogs() {
  const r = await fetch("/get_logs");
  const data = await r.json();
  const list = document.getElementById("log-list");
  if (!list) return;
  list.innerHTML =
    data
      .slice()
      .reverse()
      .map((l) => {
        const extra = l.threat_level ? `<br>Threat: <b>${escapeHtml(String(l.threat_level).toUpperCase())}</b>` : "";
        return `<div class="log-item"><b>${escapeHtml(l.time || "")}</b><br>Trigger: ${escapeHtml(l.source || "")}${extra}</div>`;
      })
      .join("") || "No alerts recorded.";
}

async function fetchLocationHistory() {
  const list = document.getElementById("location-list");
  if (list) list.innerHTML = "Loading...";
  const r = await fetch("/get_location_history");
  const data = await r.json();
  if (!list) return;
  list.innerHTML =
    data
      .slice()
      .reverse()
      .map((l) => {
        const maps = `https://www.google.com/maps?q=${encodeURIComponent(l.lat)},${encodeURIComponent(l.lon)}`;
        return `<div class="log-item"><b>${escapeHtml(l.time || "")}</b><br>🔋 ${escapeHtml(String(l.battery ?? ""))}%<br><a href="${maps}" target="_blank" style="color:#60a5fa;">Open in Maps</a></div>`;
      })
      .join("") || "No locations recorded yet.";
}

// --- Fake call + Quick dial ---
function triggerFakeCall() {
  document.getElementById("fake-call-screen").style.display = "flex";
}
function hideFakeCall() {
  document.getElementById("fake-call-screen").style.display = "none";
}

function quickDial() {
  const num = (systemConfig.quick_dial_number || "100").replace(/\s+/g, "");
  window.open(`tel:${num}`);
}

// --- Small helpers ---
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}