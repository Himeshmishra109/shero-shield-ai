import os
import json
from datetime import datetime
from flask import Flask, render_template, request, jsonify
from twilio.rest import Client # Naya library import

app = Flask(__name__)

# --- Twilio Configuration (Asli SMS ke liye) ---
# Inhe Twilio Dashboard se copy karein
TWILIO_SID = 'YOUR_ACCOUNT_SID'
TWILIO_TOKEN = 'YOUR_AUTH_TOKEN'
TWILIO_PHONE = 'YOUR_TWILIO_NUMBER'

# Folders setup
RECS_FOLDER = 'recordings'
PICS_FOLDER = 'captured_images'
for folder in [RECS_FOLDER, PICS_FOLDER]:
    if not os.path.exists(folder): os.makedirs(folder)

LOG_FILE = 'emergency_logs.json'
if not os.path.exists(LOG_FILE):
    with open(LOG_FILE, 'w') as f: json.dump([], f)

app_config = {
    "parent_number": "+919919675195",
    "trigger_keyword": "help",
    "shake_sensitivity": 35
}

def send_real_sms(to_number, message):
    try:
        client = Client(TWILIO_SID, TWILIO_TOKEN)
        client.messages.create(body=message, from_=TWILIO_PHONE, to=to_number)
        print(f"✅ Real SMS Sent to {to_number}")
    except Exception as e:
        print(f"❌ SMS Failed: {str(e)}")

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/update_settings', methods=['POST'])
def update_settings():
    data = request.get_json()
    if 'number' in data: app_config["parent_number"] = data['number']
    if 'keyword' in data: app_config["trigger_keyword"] = data['keyword'].lower()
    if 'sensitivity' in data: app_config["shake_sensitivity"] = int(data['sensitivity'])
    return jsonify({"status": "success", "config": app_config})

@app.route('/get_logs', methods=['GET'])
def get_logs():
    with open(LOG_FILE, 'r') as f: logs = json.load(f)
    return jsonify(logs)

@app.route('/trigger_sos', methods=['POST'])
def trigger_sos():
    data = request.get_json()
    lat, lon, source = data.get('lat'), data.get('lon'), data.get('source')
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    maps_link = f"https://www.google.com/maps?q={lat},{lon}"
    
    # 1. Log the event
    new_log = {"time": timestamp, "source": source, "location": maps_link}
    with open(LOG_FILE, 'r+') as f:
        logs = json.load(f)
        logs.append(new_log)
        f.seek(0)
        json.dump(logs, f)

    # 2. SEND REAL SMS
    sms_body = f"EMERGENCY! {source} triggered. Location: {maps_link}"
    send_real_sms(app_config["parent_number"], sms_body)

    police_search = f"https://www.google.com/maps/search/police+station/@{lat},{lon},15z"
    return jsonify({"status": "success", "police_link": police_search})

@app.route('/upload_evidence', methods=['POST'])
def upload_evidence():
    if 'audio' in request.files:
        request.files['audio'].save(os.path.join(RECS_FOLDER, f"audio_{os.urandom(3).hex()}.wav"))
    if 'photo' in request.files:
        request.files['photo'].save(os.path.join(PICS_FOLDER, f"capture_{os.urandom(3).hex()}.jpg"))
    return jsonify({"status": "success"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)