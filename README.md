# Settings Manager (Overwolf App)

A centralized **Overwolf Settings Manager** app. Other Overwolf applications can register settings schemas via a local HTTP server, enabling a single unified dashboard to configure all of your custom overlay apps.

## Features

- **Centralized Dashboard**: Left panel displays all registered apps, right panel renders custom settings categorized by section.
- **Rich Controls**:
  - `checkbox` (Toggles)
  - `slider` (Range sliders with live numeric value display)
  - `color` (Interactive color pickers with hex text inputs)
  - `hotkey` (Interactive keystroke recording - captures combinations like `Ctrl+Shift+H`)
  - `select` (Dropdown menus)
  - `textarea` (Multiline text editing)
  - `text` & `number` inputs
- **Real-time Persistence**: All options are saved inside the Settings Manager's `localStorage` and persist across application restarts.
- **Real-time API**: Apps can query values via a simple local HTTP server.

---

## Developer Integration API

The Settings Manager runs a local HTTP server on port **`61235`**.

### 1. Registering Settings Schema

To register your app and set up its fields, make an HTTP `POST` request to `http://localhost:61235/register`:

```json
{
  "app": "Warzone Helper",
  "icon": "https://cdn.simpleicons.org/codstatus",
  "settings": [
    {
      "key": "enable_vpn_alerts",
      "label": "VPN Connection Alerts",
      "description": "Alert when connected to a suspicious or high-latency server.",
      "type": "checkbox",
      "category": "Alerts",
      "default": true
    },
    {
      "key": "hud_opacity",
      "label": "HUD Opacity",
      "type": "slider",
      "category": "Appearance",
      "min": 10,
      "max": 100,
      "step": 5,
      "default": 90
    },
    {
      "key": "custom_overlay_color",
      "label": "Overlay Accent Color",
      "type": "color",
      "category": "Appearance",
      "default": "#4aa3ff"
    },
    {
      "key": "toggle_hotkey",
      "label": "Toggle UI Hotkey",
      "type": "hotkey",
      "category": "Controls",
      "default": "Ctrl+Shift+H"
    }
  ]
}
```

*Note: Calling `/register` is safe on every app startup. If the app is already registered, existing saved settings will be preserved, and defaults will only fill in for new setting keys.*

### 2. Reading App Settings

To fetch the current settings values for your app, read them from the central `localStorage` (for shared origin apps) or poll them via the HTTP API:

*To be implemented: A quick client snippet can read settings.*

---

## Installation (Unpacked)

1. Open Overwolf ➔ Settings ➔ **Support** ➔ **Development options** ➔ **Load unpacked extension**.
2. Select the `settings-manager` folder (containing `manifest.json`).
3. The dashboard UI will load immediately.
