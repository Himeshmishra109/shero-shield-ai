# Safety Guard AI - Emergency Alert System

A real-time safety application with voice detection, motion sensing, and automatic SMS alerts.

## Features

- 🚨 SOS Emergency Button with 5-second countdown + threat level (High/Medium/Low)
- 🎤 Voice-activated alerts (customizable trigger word)
- 📱 Shake detection for hands-free emergency activation
- 📸 Automatic photo + audio evidence capture
- 🎥 Optional 10s video evidence capture (manual button)
- 📲 Real SMS alerts via Twilio to emergency contacts (+ WhatsApp fallback)
- 📍 GPS location sharing with Google Maps links + location history
- 📞 Fake call screen for discreet situations
- 📜 Emergency event logging
- 🛡️ Geofencing safe zones (alerts when you leave a safe zone)
- 📍 Live tracking (periodic location updates)
- ⏰ Check-in timer (missed check-in alerts)
- 🔋 Low-battery alerts (uses browser Battery API when available)
- 📞 Quick dial (configurable)

## Setup Instructions

### 1. Install Dependencies

```bash
cd "shero-shield-ai/safety app"
pip install -r requirements.txt
```

### 2. Configure Twilio SMS Service

1. Create a free account at [Twilio](https://www.twilio.com/try-twilio)
2. Get your credentials from the Twilio Console:
   - Account SID
   - Auth Token
   - Twilio Phone Number

3. Set environment variables (recommended):

**PowerShell**

```powershell
$env:TWILIO_SID="your_account_sid_here"
$env:TWILIO_TOKEN="your_auth_token_here"
$env:TWILIO_PHONE="+1234567890"
```

If you don’t set these, the app will still run, but sending messages will fail (and you’ll see an error in the terminal).

### 3. Run the Application

```bash
python app.py
```

The app will start on `http://localhost:5000`

### 4. Configure Settings in App

1. Click the ⚙️ Settings icon
2. Set your trigger keyword (default: `help`)
3. Adjust shake sensitivity (20-60)
4. Enable any of: Silent mode, Live tracking, Geofencing, Check-in, Battery alerts
5. Set Quick Dial number (optional)
6. Click “Save All Settings”
7. Add / remove emergency contacts via the 👥 icon

## Usage

### Manual SOS
- Press the red SOS button
- Choose a threat level
- 5-second countdown allows cancellation
- SMS sent with GPS location after countdown

### Voice Activation
- Say your trigger word (default: "help")
- Automatic emergency sequence starts

### Shake Detection
- Shake your device vigorously
- Triggers emergency alert automatically

### Fake Call Mode
- Click "📞 Fake Call" button
- Displays realistic incoming call screen
- Use to discreetly exit uncomfortable situations

## Browser Permissions Required

- 🎤 Microphone (for voice detection & audio recording)
- 📸 Camera (for photo evidence)
- 🎥 Camera + Microphone (for video evidence)
- 📍 Location (for GPS coordinates)

## Security Notes

- Keep your Twilio credentials private
- Never commit credentials to version control
- Test the system before relying on it
- Ensure emergency contact number is correct

## File Structure

```
safety app/
├── app.py                  # Flask backend
├── requirements.txt        # Python dependencies
├── app_config.json         # Saved settings (created at runtime)
├── emergency_contacts.json # Saved contacts (created at runtime)
├── emergency_logs.json     # Event history
├── location_tracking.json  # Location history (created at runtime)
├── safe_zones.json         # Geofence zones (created at runtime)
├── templates/
│   └── index.html         # Main UI
├── static/
│   ├── css/
│   │   └── style.css      # Styling
│   └── js/
│       └── script.js      # Frontend logic
├── recordings/            # Audio evidence
├── captured_images/       # Photo evidence
└── videos/                # Video evidence
```

## Troubleshooting

**SMS not sending:**
- Verify Twilio credentials are correct
- Check Twilio account balance
- Ensure phone number format includes country code

**Voice detection not working:**
- Grant microphone permissions in browser
- Use Chrome/Edge (best compatibility)
- Speak clearly near microphone

**Shake detection not triggering:**
- Adjust sensitivity in settings
- Use on mobile device (desktop may not have accelerometer)

## Support

For issues or questions, check:
- Twilio documentation: https://www.twilio.com/docs
- Flask documentation: https://flask.palletsprojects.com/

---

**⚠️ Important:** This is an emergency safety tool. Always have backup emergency plans and know local emergency numbers.
