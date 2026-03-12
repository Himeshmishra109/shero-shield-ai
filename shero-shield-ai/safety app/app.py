import os
import json
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify
from twilio.rest import Client
import threading
import time

app = Flask(__name__)

# --- Twilio Configuration ---
TWILIO_SID = os.environ.get("TWILIO_SID", "YOUR_ACCOUNT_SID")
TWILIO_TOKEN = os.environ.get("TWILIO_TOKEN", "YOUR_AUTH_TOKEN")
TWILIO_PHONE = os.environ.get("TWILIO_PHONE", "YOUR_TWILIO_NUMBER")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def _abs(*parts):
    return os.path.join(BASE_DIR, *parts)

# Folders setup
RECS_FOLDER = _abs('recordings')
PICS_FOLDER = _abs('captured_images')
VIDEOS_FOLDER = _abs('videos')
for folder in [RECS_FOLDER, PICS_FOLDER, VIDEOS_FOLDER]:
    if not os.path.exists(folder): os.makedirs(folder)

LOG_FILE = _abs('emergency_logs.json')
TRACKING_FILE = _abs('location_tracking.json')
CONTACTS_FILE = _abs('emergency_contacts.json')
GEOFENCE_FILE = _abs('safe_zones.json')
CONFIG_FILE = _abs('app_config.json')

def _try_migrate_from_repo_root(abs_target_path, default_value):
    """
    Older versions of this repo stored JSON files in the git root.
    If the app-local file is missing but a root-level file exists, migrate it.
    """
    if os.path.exists(abs_target_path):
        return
    repo_root_candidate = os.path.abspath(os.path.join(BASE_DIR, "..", "..", ".."))
    root_path = os.path.join(repo_root_candidate, os.path.basename(abs_target_path))
    if os.path.exists(root_path):
        try:
            with open(root_path, "r", encoding="utf-8") as rf:
                data = json.load(rf)
            with open(abs_target_path, "w", encoding="utf-8") as wf:
                json.dump(data, wf)
            return
        except Exception:
            pass
    with open(abs_target_path, "w", encoding="utf-8") as wf:
        json.dump(default_value, wf)

_try_migrate_from_repo_root(LOG_FILE, [])
_try_migrate_from_repo_root(TRACKING_FILE, [])
_try_migrate_from_repo_root(CONTACTS_FILE, [])
_try_migrate_from_repo_root(GEOFENCE_FILE, {"zones": []})

DEFAULT_CONFIG = {
    "trigger_keyword": "help",
    "shake_sensitivity": 35,
    "silent_mode": False,
    "live_tracking": False,
    "tracking_interval": 30,
    "check_in_enabled": False,
    "check_in_interval": 60,
    "last_check_in": None,
    "geofencing_enabled": False,
    "battery_alert_threshold": 20,
    "quick_dial_number": "100",
}

def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def _write_json(path, value):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(value, f)
    os.replace(tmp, path)

def _load_config():
    cfg = dict(DEFAULT_CONFIG)
    cfg.update(_read_json(CONFIG_FILE, {}))
    return cfg

def _save_config():
    _write_json(CONFIG_FILE, {k: app_config.get(k) for k in DEFAULT_CONFIG.keys()})

def _load_contacts():
    contacts = _read_json(CONTACTS_FILE, [])
    if isinstance(contacts, dict) and "contacts" in contacts:
        contacts = contacts["contacts"]
    if not isinstance(contacts, list):
        contacts = []
    normalized = []
    for c in contacts:
        if not isinstance(c, dict):
            continue
        name = str(c.get("name", "")).strip() or "Contact"
        number = str(c.get("number", "")).strip()
        try:
            priority = int(c.get("priority", 99))
        except Exception:
            priority = 99
        if number:
            normalized.append({"name": name, "number": number, "priority": priority})
    if not normalized:
        normalized = [{"name": "Parent", "number": "+919455065432", "priority": 1}]
    return normalized

def _save_contacts():
    _write_json(CONTACTS_FILE, app_config["emergency_contacts"])

app_config = _load_config()
app_config["emergency_contacts"] = _load_contacts()

# Global tracking state
tracking_active = False
check_in_timer = None

def send_real_sms(to_number, message):
    try:
        if not TWILIO_SID or "YOUR_ACCOUNT_SID" in TWILIO_SID:
            raise RuntimeError("Twilio credentials not configured")
        client = Client(TWILIO_SID, TWILIO_TOKEN)
        client.messages.create(body=message, from_=TWILIO_PHONE, to=to_number)
        print(f"✅ Real SMS Sent to {to_number}")
        return True
    except Exception as e:
        print(f"❌ SMS Failed: {str(e)}")
        return False

def send_whatsapp_message(to_number, message):
    """Send WhatsApp message via Twilio (requires WhatsApp-enabled number)"""
    try:
        if not TWILIO_SID or "YOUR_ACCOUNT_SID" in TWILIO_SID:
            raise RuntimeError("Twilio credentials not configured")
        client = Client(TWILIO_SID, TWILIO_TOKEN)
        client.messages.create(
            body=message,
            from_=f'whatsapp:{TWILIO_PHONE}',
            to=f'whatsapp:{to_number}'
        )
        print(f"✅ WhatsApp Sent to {to_number}")
        return True
    except Exception as e:
        print(f"❌ WhatsApp Failed: {str(e)}")
        return False

def broadcast_alert(message, threat_level="high"):
    """Send alert to all emergency contacts based on priority"""
    contacts = app_config["emergency_contacts"]
    sorted_contacts = sorted(contacts, key=lambda x: x.get("priority", 99))
    
    results = []
    for contact in sorted_contacts:
        # Send SMS
        sms_sent = send_real_sms(contact["number"], message)
        
        # Try WhatsApp as backup if SMS fails or for high threat
        if not sms_sent or threat_level == "high":
            send_whatsapp_message(contact["number"], message)
        
        results.append({"name": contact["name"], "sent": sms_sent})
    
    return results

def start_live_tracking():
    """Background thread for continuous location tracking"""
    global tracking_active
    tracking_active = True
    
    def track():
        while tracking_active:
            # This will be updated by frontend via /update_location
            time.sleep(app_config["tracking_interval"])
    
    thread = threading.Thread(target=track, daemon=True)
    thread.start()

def check_geofence(lat, lon):
    """Check if current location is outside safe zones"""
    with open(GEOFENCE_FILE, 'r') as f:
        data = json.load(f)
    
    if not app_config["geofencing_enabled"] or not data["zones"]:
        return True
    
    from math import radians, sin, cos, sqrt, atan2
    
    for zone in data["zones"]:
        # Haversine formula to calculate distance
        R = 6371000  # Earth radius in meters
        lat1, lon1 = radians(lat), radians(lon)
        lat2, lon2 = radians(zone["lat"]), radians(zone["lon"])
        
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        c = 2 * atan2(sqrt(a), sqrt(1-a))
        distance = R * c
        
        if distance <= zone["radius"]:
            return True  # Inside safe zone
    
    return False  # Outside all safe zones

def start_check_in_monitor():
    """Monitor for missed check-ins"""
    global check_in_timer
    
    def monitor():
        while app_config["check_in_enabled"]:
            if app_config["last_check_in"]:
                last_time = datetime.fromisoformat(app_config["last_check_in"])
                elapsed = (datetime.now() - last_time).total_seconds() / 60
                
                if elapsed > app_config["check_in_interval"]:
                    # Missed check-in - send alert
                    message = "⚠️ MISSED CHECK-IN ALERT! User has not checked in as scheduled. Last check-in: " + app_config["last_check_in"]
                    broadcast_alert(message, "medium")
                    app_config["check_in_enabled"] = False  # Disable to prevent spam
            
            time.sleep(60)  # Check every minute
    
    check_in_timer = threading.Thread(target=monitor, daemon=True)
    check_in_timer.start()

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/get_config', methods=['GET'])
def get_config():
    public_config = dict(app_config)
    public_config.pop("emergency_contacts", None)
    return jsonify({
        "config": public_config,
        "contacts": app_config["emergency_contacts"],
    })

@app.route('/update_settings', methods=['POST'])
def update_settings():
    data = request.get_json()
    
    if 'keyword' in data: 
        app_config["trigger_keyword"] = data['keyword'].lower()
    if 'sensitivity' in data: 
        app_config["shake_sensitivity"] = int(data['sensitivity'])
    if 'silent_mode' in data:
        app_config["silent_mode"] = data['silent_mode']
    # Accept either live_tracking or legacy enabled field
    if 'live_tracking' in data:
        app_config["live_tracking"] = bool(data['live_tracking'])
    if 'enabled' in data:
        app_config["live_tracking"] = bool(data['enabled'])
    if 'tracking_interval' in data:
        app_config["tracking_interval"] = int(data['tracking_interval'])
    if 'check_in_interval' in data:
        app_config["check_in_interval"] = int(data['check_in_interval'])
    if 'battery_threshold' in data:
        app_config["battery_alert_threshold"] = int(data['battery_threshold'])
    if 'geofencing_enabled' in data:
        app_config["geofencing_enabled"] = data['geofencing_enabled']
    if 'quick_dial_number' in data:
        app_config["quick_dial_number"] = str(data['quick_dial_number']).strip() or DEFAULT_CONFIG["quick_dial_number"]
    
    _save_config()
    
    return jsonify({"status": "success", "config": app_config})

@app.route('/manage_contacts', methods=['GET', 'POST', 'DELETE'])
def manage_contacts():
    if request.method == 'GET':
        return jsonify(app_config["emergency_contacts"])
    
    elif request.method == 'POST':
        contact = request.get_json()
        if not isinstance(contact, dict):
            return jsonify({"status": "error", "message": "Invalid contact"}), 400
        name = str(contact.get("name", "")).strip() or "Contact"
        number = str(contact.get("number", "")).strip()
        try:
            priority = int(contact.get("priority", 99))
        except Exception:
            priority = 99
        if not number:
            return jsonify({"status": "error", "message": "Number required"}), 400
        app_config["emergency_contacts"].append({"name": name, "number": number, "priority": priority})
        _save_contacts()
        return jsonify({"status": "success", "contacts": app_config["emergency_contacts"]})
    
    elif request.method == 'DELETE':
        index = request.get_json().get('index')
        if 0 <= index < len(app_config["emergency_contacts"]):
            app_config["emergency_contacts"].pop(index)
            _save_contacts()
        return jsonify({"status": "success", "contacts": app_config["emergency_contacts"]})

@app.route('/toggle_tracking', methods=['POST'])
def toggle_tracking():
    data = request.get_json()
    app_config["live_tracking"] = data.get('enabled', False)
    
    if app_config["live_tracking"]:
        start_live_tracking()
    else:
        global tracking_active
        tracking_active = False
    
    _save_config()
    return jsonify({"status": "success", "tracking": app_config["live_tracking"]})

@app.route('/update_location', methods=['POST'])
def update_location():
    data = request.get_json()
    lat, lon = data.get('lat'), data.get('lon')
    battery = data.get('battery', 100)
    if lat is None or lon is None:
        return jsonify({"status": "error", "message": "lat/lon required"}), 400
    try:
        lat = float(lat)
        lon = float(lon)
    except Exception:
        return jsonify({"status": "error", "message": "lat/lon must be numbers"}), 400
    try:
        battery = int(battery)
    except Exception:
        battery = 100
    
    # Save to tracking log
    with open(TRACKING_FILE, 'r+') as f:
        logs = json.load(f)
        logs.append({
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "lat": lat,
            "lon": lon,
            "battery": battery
        })
        # Keep only last 100 locations
        logs = logs[-100:]
        f.seek(0)
        f.truncate()
        json.dump(logs, f)
    
    # Check geofence
    if not check_geofence(lat, lon):
        maps_link = f"https://www.google.com/maps?q={lat},{lon}"
        message = f"⚠️ GEOFENCE ALERT! User left safe zone. Current location: {maps_link}"
        broadcast_alert(message, "medium")
    
    # Check battery
    if battery <= app_config["battery_alert_threshold"]:
        maps_link = f"https://www.google.com/maps?q={lat},{lon}"
        message = f"🔋 LOW BATTERY ALERT! Battery at {battery}%. Last location: {maps_link}"
        broadcast_alert(message, "low")
    
    return jsonify({"status": "success"})

@app.route('/check_in', methods=['POST'])
def check_in():
    app_config["last_check_in"] = datetime.now().isoformat()
    app_config["check_in_enabled"] = True
    
    if not check_in_timer or not check_in_timer.is_alive():
        start_check_in_monitor()
    
    return jsonify({"status": "success", "time": app_config["last_check_in"]})

@app.route('/add_safe_zone', methods=['POST'])
def add_safe_zone():
    zone = request.get_json()
    if not isinstance(zone, dict):
        return jsonify({"status": "error", "message": "Invalid zone"}), 400
    if "lat" not in zone or "lon" not in zone or "radius" not in zone:
        return jsonify({"status": "error", "message": "lat/lon/radius required"}), 400
    zone_obj = {
        "name": str(zone.get("name", "")).strip() or "Safe Zone",
        "lat": float(zone["lat"]),
        "lon": float(zone["lon"]),
        "radius": float(zone["radius"]),
        "created_at": datetime.now().isoformat(),
    }
    
    with open(GEOFENCE_FILE, 'r+') as f:
        data = json.load(f)
        data["zones"].append(zone_obj)
        f.seek(0)
        f.truncate()
        json.dump(data, f)
    
    return jsonify({"status": "success"})

@app.route('/delete_safe_zone', methods=['POST'])
def delete_safe_zone():
    payload = request.get_json() or {}
    index = payload.get("index")
    try:
        index = int(index)
    except Exception:
        return jsonify({"status": "error", "message": "index required"}), 400
    with open(GEOFENCE_FILE, "r+", encoding="utf-8") as f:
        data = json.load(f)
        zones = data.get("zones", [])
        if 0 <= index < len(zones):
            zones.pop(index)
        data["zones"] = zones
        f.seek(0)
        f.truncate()
        json.dump(data, f)
    return jsonify({"status": "success", "zones": zones})

@app.route('/get_safe_zones', methods=['GET'])
def get_safe_zones():
    with open(GEOFENCE_FILE, 'r') as f:
        data = json.load(f)
    return jsonify(data["zones"])

@app.route('/get_location_history', methods=['GET'])
def get_location_history():
    with open(TRACKING_FILE, 'r') as f:
        logs = json.load(f)
    return jsonify(logs)

@app.route('/get_logs', methods=['GET'])
def get_logs():
    with open(LOG_FILE, 'r') as f: logs = json.load(f)
    return jsonify(logs)

@app.route('/trigger_sos', methods=['POST'])
def trigger_sos():
    data = request.get_json()
    lat, lon, source = data.get('lat'), data.get('lon'), data.get('source')
    threat_level = data.get('threat_level', 'high')
    try:
        lat = float(lat)
        lon = float(lon)
    except Exception:
        return jsonify({"status": "error", "message": "lat/lon must be numbers"}), 400
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    maps_link = f"https://www.google.com/maps?q={lat},{lon}"
    
    # 1. Log the event
    new_log = {
        "time": timestamp, 
        "source": source, 
        "location": maps_link,
        "threat_level": threat_level,
        "silent_mode": app_config["silent_mode"]
    }
    with open(LOG_FILE, 'r+') as f:
        logs = json.load(f)
        logs.append(new_log)
        f.seek(0)
        f.truncate()
        json.dump(logs, f)

    # 2. Broadcast to all contacts
    threat_emoji = {"high": "🚨", "medium": "⚠️", "low": "ℹ️"}
    sms_body = f"{threat_emoji.get(threat_level, '🚨')} EMERGENCY ALERT!\n"
    sms_body += f"Trigger: {source}\n"
    sms_body += f"Threat Level: {threat_level.upper()}\n"
    sms_body += f"Time: {timestamp}\n"
    sms_body += f"Location: {maps_link}\n"
    
    if app_config["silent_mode"]:
        sms_body += "\n⚠️ SILENT MODE - No sound/vibration on device"
    
    broadcast_alert(sms_body, threat_level)

    # 3. Start live tracking automatically
    if not app_config["live_tracking"]:
        app_config["live_tracking"] = True
        start_live_tracking()

    police_search = f"https://www.google.com/maps/search/police+station/@{lat},{lon},15z"
    hospital_search = f"https://www.google.com/maps/search/hospital/@{lat},{lon},15z"
    
    return jsonify({
        "status": "success", 
        "police_link": police_search,
        "hospital_link": hospital_search,
        "contacts_notified": len(app_config["emergency_contacts"])
    })

@app.route('/upload_evidence', methods=['POST'])
def upload_evidence():
    files_saved = []
    
    if 'audio' in request.files:
        filename = f"audio_{os.urandom(3).hex()}.wav"
        request.files['audio'].save(os.path.join(RECS_FOLDER, filename))
        files_saved.append(filename)
    
    if 'photo' in request.files:
        filename = f"capture_{os.urandom(3).hex()}.jpg"
        request.files['photo'].save(os.path.join(PICS_FOLDER, filename))
        files_saved.append(filename)
    
    if 'video' in request.files:
        filename = f"video_{os.urandom(3).hex()}.webm"
        request.files['video'].save(os.path.join(VIDEOS_FOLDER, filename))
        files_saved.append(filename)
    
    return jsonify({"status": "success", "files": files_saved})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)