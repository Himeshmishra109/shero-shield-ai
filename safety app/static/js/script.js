let sosTimer, countdown = 5, isAlertCancelled = false, mediaRecorder, audioChunks = [];
let trackingInterval, systemConfig = { keyword: 'help', sensitivity: 35 };

// --- UI Toggle Functions ---
function toggleSettings() {
    const m = document.getElementById('settings-modal');
    m.style.display = m.style.display === 'none' ? 'flex' : 'none';
}

function toggleLogs() {
    const m = document.getElementById('logs-panel');
    m.style.display = m.style.display === 'none' ? 'flex' : 'none';
    if(m.style.display === 'flex') fetchLogs();
}

// --- Sync Settings with Twilio Backend ---
function saveSettings() {
    systemConfig.keyword = document.getElementById('keyword-input').value.toLowerCase() || 'help';
    systemConfig.sensitivity = document.getElementById('sensitivity-range').value;
    
    fetch('/update_settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ 
            number: document.getElementById('parent-num').value,
            keyword: systemConfig.keyword,
            sensitivity: systemConfig.sensitivity
        })
    }).then(() => {
        toggleSettings();
        alert("System Updated Successfully!");
    });
}

// --- Emergency Core Logic ---
function startEmergencySequence(source) {
    isAlertCancelled = false; countdown = 5;
    document.getElementById('cancel-zone').style.display = 'block';
    sosTimer = setInterval(() => {
        countdown--;
        document.getElementById('timer').innerText = countdown;
        if (countdown <= 0) {
            clearInterval(sosTimer);
            if (!isAlertCancelled) triggerSOS(source);
            document.getElementById('cancel-zone').style.display = 'none';
        }
    }, 1000);
}

function triggerSOS(source) {
    document.getElementById('status-log').innerText = "🚨 SMS & ALERTS DISPATCHED";
    document.querySelectorAll('.auth-box').forEach(b => b.classList.add('alert-on'));
    
    capturePhoto(); captureAudio();
    navigator.geolocation.getCurrentPosition(pos => {
        fetch('/trigger_sos', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                lat: pos.coords.latitude, 
                lon: pos.coords.longitude, 
                source: source 
            })
        });
    });
}

// --- Voice & Motion Sensors ---
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.continuous = true;
recognition.onresult = (event) => {
    const lastResult = event.results[event.results.length - 1][0].transcript.toLowerCase();
    if(lastResult.includes(systemConfig.keyword)) startEmergencySequence("Voice Trigger");
};
recognition.start();

window.ondevicemotion = (e) => {
    if (Math.abs(e.accelerationIncludingGravity.x) > systemConfig.sensitivity) {
        startEmergencySequence("Shake Detected");
    }
};

// --- Evidence & Extra Features ---
async function capturePhoto() {
    const video = document.getElementById('webcam');
    const canvas = document.getElementById('canvas');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        setTimeout(() => {
            canvas.getContext('2d').drawImage(video, 0, 0, 300, 150);
            canvas.toBlob(blob => {
                const fd = new FormData(); fd.append('photo', blob);
                fetch('/upload_evidence', { method: 'POST', body: fd });
                stream.getTracks().forEach(t => t.stop());
            });
        }, 2000);
    } catch(e) { console.warn("Camera access denied"); }
}

async function captureAudio() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            const fd = new FormData(); fd.append('audio', new Blob(audioChunks));
            fetch('/upload_evidence', { method: 'POST', body: fd });
        };
        mediaRecorder.start();
        setTimeout(() => mediaRecorder.stop(), 5000);
    } catch(e) { console.warn("Mic access denied"); }
}

function fetchLogs() {
    fetch('/get_logs').then(r => r.json()).then(data => {
        document.getElementById('log-list').innerHTML = data.reverse().map(l => 
            `<div class="log-item"><b>${l.time}</b><br>Trigger: ${l.source}</div>`
        ).join('') || "No alerts recorded.";
    });
}

function triggerFakeCall() { document.getElementById('fake-call-screen').style.display = 'flex'; }
function hideFakeCall() { document.getElementById('fake-call-screen').style.display = 'none'; }
function cancelAlert() { isAlertCancelled = true; clearInterval(sosTimer); document.getElementById('cancel-zone').style.display = 'none'; }