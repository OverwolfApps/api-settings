// Settings Manager — Background Controller
//
// Hosts a WebSocket server on port 60236.
// Other Overwolf apps connect and send { event: 'register', ... } to register schemas
// and { event: 'set', ... } to update settings values.

const WS_PORT = 60236;

const state = {
  server: null,
  // Map of appName -> { schema: [...], values: { ... } }
  apps: {},
};
window.settingsState = state; // settings_ui reads this via overwolf.windows.getMainWindow().settingsState

// Load saved schemas and settings values from localStorage on startup
function loadState() {
  try {
    const saved = localStorage.getItem('sm_apps_state');
    if (saved) {
      state.apps = JSON.parse(saved);
      console.log('[settings-manager] loaded state:', Object.keys(state.apps));
    }
  } catch (e) {
    console.error('[settings-manager] failed to load state:', e);
  }
}

function saveState() {
  try {
    localStorage.setItem('sm_apps_state', JSON.stringify(state.apps));
    // Broadcast via Overwolf extensions registry
    try {
      overwolf.extensions.setInfo(state.apps);
    } catch (e) {
      console.error('[settings-manager] failed to setInfo on init:', e);
    }
  } catch (e) {
    console.error('[settings-manager] failed to save state:', e);
  }
}



// Register an app's schema and initialize its values
function registerApp(data) {
  const name = data.app;
  if (!name) return;

  const existing = state.apps[name] || { values: {} };
  const schema = data.settings || [];
  
  // Set defaults for missing keys
  const values = { ...existing.values };
  schema.forEach(item => {
    if (values[item.key] === undefined) {
      values[item.key] = item.default !== undefined ? item.default : null;
    }
  });

  const saveApp = (resolvedIcon) => {
    state.apps[name] = {
      app: name,
      icon: resolvedIcon || '',
      settings: schema,
      values: values,
      updatedAt: Date.now()
    };

    saveState();
    console.log(`[settings-manager] registered app "${name}" with ${schema.length} settings, icon: ${resolvedIcon}`);

    // Notify settings_ui window if open
    overwolf.windows.sendMessage('settings_ui', 'app-registered', { app: name }, () => {});
  };

  // Resolve local icon path to overwolf-extension:// URL if it is a local path
  if (data.icon && !data.icon.startsWith('http') && !data.icon.startsWith('overwolf-extension:')) {
    try {
      overwolf.extensions.getExtensions((r) => {
        try {
          let extId = null;
          const list = Array.isArray(r) ? r : (r && r.extensions ? r.extensions : []);
          const parsedExtensions = list.map(e => {
            if (typeof e === 'string') {
              try { return JSON.parse(e); } catch { return null; }
            }
            return e;
          }).filter(Boolean);

          const ext = parsedExtensions.find(e => {
            if (!e || !e.meta) return false;
            const nameMatch = e.meta.name === name;
            const gameHelperMatch = (name === 'Warzone Helper' && e.meta.name === 'Game Helper');
            return nameMatch || gameHelperMatch;
          });

          if (ext) {
            extId = ext.UID || ext.id;
            console.log('[settings-manager] Found matching extension:', ext.meta.name, 'id:', extId);
          } else {
            console.log('[settings-manager] No matching extension found for name:', name);
          }
          const resolvedIcon = extId ? `overwolf-extension://${extId}/${data.icon}` : data.icon;
          saveApp(resolvedIcon);
        } catch (err) {
          console.error('[settings-manager] error in getExtensions callback:', err);
          saveApp(data.icon);
        }
      });
    } catch (err) {
      console.error('[settings-manager] failed to call getExtensions:', err);
      saveApp(data.icon);
    }
  } else {
    saveApp(data.icon);
  }
}

// --- WebSocket Server ----------------------------------------------------------------------
let wsPlugin = null;

function startWsServer() {
  try {
    overwolf.extensions.current.getExtraObject("websocket-server-plugin", (result) => {
      if (result.status === "success") {
        wsPlugin = result.object;
        wsPlugin.OnMessage.addListener((msg) => {
          console.log('[settings-manager] WS received message:', msg);
          try {
            const data = JSON.parse(msg);
            if (data && data.event === 'register') {
              console.log('[settings-manager] WS register event received for app:', data.app);
              registerApp(data);
              // Send back current values
              const response = JSON.stringify({
                event: 'settings-changed',
                app: data.app,
                values: state.apps[data.app].values
              });
              wsPlugin.Send(response, () => {});
            } else if (data && data.event === 'set') {
              console.log('[settings-manager] WS set event received for app:', data.app);
              if (data.app && data.values) {
                updateSettingsValues(data.app, data.values);
              }
            }
          } catch (e) {
            console.error('[settings-manager] Failed to parse WS message:', e);
          }
        });
        wsPlugin.OnStatus.addListener((status) => {
          console.log('[settings-manager] WS Server Status:', status);
        });
        wsPlugin.Start(60236, (startRes) => {
          if (startRes && startRes.success) {
            console.log('[settings-manager] WS Server started on port 60236.');
          } else {
            console.error('[settings-manager] WS Server failed to start:', startRes.error);
          }
        });
      } else {
        console.error('[settings-manager] Failed to load WebSocket plugin:', result);
      }
    });
  } catch (err) {
    console.error('[settings-manager] Exception loading WS plugin:', err);
  }
}

const pendingWsUpdates = {};
const pendingWsTimers = {};

// Update settings values for an app (e.g. programmatically from the app itself)
function updateSettingsValues(appName, patch) {
  const app = state.apps[appName];
  if (!app) return;

  const actualPatch = {};
  let hasActualChanges = false;
  for (const [key, val] of Object.entries(patch)) {
    if (app.values[key] !== val) {
      actualPatch[key] = val;
      hasActualChanges = true;
    }
  }

  if (!hasActualChanges) return;

  app.values = { ...app.values, ...patch };
  app.updatedAt = Date.now();
  saveState();

  console.log(`[settings-manager] updated values for "${appName}":`, JSON.stringify(actualPatch));

  if (appName === 'Settings (API)' && patch.toggle_settings_ui !== undefined) {
    updateOverwolfHotkey(patch.toggle_settings_ui);
  }

  if (patch.autoLaunch !== undefined) {
    setAppAutoStart(appName, patch.autoLaunch);
  }

  // Notify settings_ui window if open (UI still gets full state)
  overwolf.windows.sendMessage('settings_ui', 'values-changed', { app: appName, values: app.values }, () => {});

  // Broadcast settings change to all connected WebSocket clients (bulk queue max 1s)
  if (wsPlugin) {
    if (!pendingWsUpdates[appName]) pendingWsUpdates[appName] = {};
    Object.assign(pendingWsUpdates[appName], actualPatch);

    if (pendingWsTimers[appName]) {
      clearTimeout(pendingWsTimers[appName]);
    }
    
    pendingWsTimers[appName] = setTimeout(() => {
      const mergedPatch = pendingWsUpdates[appName];
      if (Object.keys(mergedPatch).length > 0) {
        try {
          const payload = JSON.stringify({ event: 'settings-changed', app: appName, values: mergedPatch });
          console.log(`[settings-manager] Broadcasting settings-changed via WS for ${appName}:`, payload);
          wsPlugin.Send(payload, () => {});
        } catch (err) {
          console.error('[settings-manager] failed to broadcast settings change via WS:', err);
        }
      }
      pendingWsUpdates[appName] = {};
      pendingWsTimers[appName] = null;
    }, 1000);
  }
}

function setAppAutoStart(appName, enabled) {
  overwolf.extensions.getExtensions((r) => {
    if (!r || !r.extensions) return;
    const ext = r.extensions.find(e => e.meta && (e.meta.name === appName || (appName === 'Warzone Helper' && e.meta.name === 'Game Helper')));
    if (ext) {
      console.log(`[settings-manager] Sending set-autostart (${enabled}) command to ${appName}`);
      overwolf.windows.sendMessage(ext.id, 'background', 'set-autostart', { enabled }, () => {});
    }
  });
}

function handleLaunch(info) {
  console.log('[settings-manager] launch triggered:', info);
  const isAutoLaunch = info && (info.source === 'startup' || info.source === 'gamelaunchevent');
  const isBackgroundLaunch = info && info.parameter && info.parameter.background;
  
  if (isAutoLaunch || isBackgroundLaunch) {
    console.log('[settings-manager] Launching in background/minimized (skipping UI restore).');
    return;
  }

  // Restore Settings UI on manual or normal launch
  overwolf.windows.obtainDeclaredWindow('settings_ui', (r) => {
    if (r && r.status === 'success') {
      overwolf.windows.restore(r.window.id, () => {});
    }
  });
}

// Monitor game launches/exits centrally
overwolf.games.onGameInfoUpdated.addListener((info) => {
  if (!info) return;
  const isRunning = info.isRunning;
  const gameChanged = info.runningChanged;
  
  if (gameChanged) {
    if (isRunning) {
      console.log('[settings-manager] Game launched. Starting enabled apps...');
      Object.keys(state.apps).forEach(appName => {
        const app = state.apps[appName];
        if (app.values && app.values.autoLaunch !== false) {
          launchAppByName(appName);
        }
      });
    } else {
      console.log('[settings-manager] Game exited. Shutting down apps with closeOnGameExit enabled...');
      Object.keys(state.apps).forEach(appName => {
        const app = state.apps[appName];
        if (app.values && app.values.closeOnGameExit === true) {
          shutdownAppByName(appName);
        }
      });
    }
  }
});

function launchAppByName(name) {
  overwolf.extensions.getExtensions((r) => {
    if (!r || !r.extensions) return;
    const ext = r.extensions.find(e => e.meta && (e.meta.name === name || (name === 'Warzone Helper' && e.meta.name === 'Game Helper')));
    if (ext) {
      overwolf.extensions.getRunningState(ext.id, (stateRes) => {
        if (stateRes && !stateRes.isRunning) {
          console.log(`[settings-manager] Auto-launching ${name}`);
          overwolf.extensions.launch(ext.id, { background: true });
        }
      });
    }
  });
}

function shutdownAppByName(name) {
  overwolf.extensions.getExtensions((r) => {
    if (!r || !r.extensions) return;
    const ext = r.extensions.find(e => e.meta && (e.meta.name === name || (name === 'Warzone Helper' && e.meta.name === 'Game Helper')));
    if (ext) {
      console.log(`[settings-manager] Sending shutdown command to ${name}`);
      overwolf.windows.sendMessage(ext.id, 'background', 'shutdown-app', {}, () => {});
    }
  });
}

function updateOverwolfHotkey(hotkeyStr) {
  if (!hotkeyStr || hotkeyStr === 'None') {
    try {
      overwolf.settings.hotkeys.unassign({ name: 'toggle_settings_ui' }, (res) => {
        console.log('[settings-manager] hotkeys.unassign result:', res);
      });
    } catch (e) {
      console.error('[settings-manager] failed to unassign hotkey:', e);
    }
    return;
  }

  const parts = hotkeyStr.split('+');
  const modifiers = {
    ctrl: false,
    shift: false,
    alt: false
  };
  let keyChar = '';
  
  parts.forEach(part => {
    const p = part.toLowerCase();
    if (p === 'ctrl') modifiers.ctrl = true;
    else if (p === 'shift') modifiers.shift = true;
    else if (p === 'alt') modifiers.alt = true;
    else keyChar = part;
  });
  
  if (!keyChar) return;
  
  // Map standard chars to virtual key codes
  let virtualKey = keyChar.toUpperCase().charCodeAt(0);
  const keyUpper = keyChar.toUpperCase();
  if (/^F[1-9][0-2]?$/.test(keyUpper)) {
    const num = parseInt(keyUpper.substring(1));
    virtualKey = 111 + num; // F1 is 112
  }
  
  const newHotkey = {
    name: 'toggle_settings_ui',
    virtualKey: virtualKey,
    modifiers: modifiers
  };
  
  try {
    overwolf.settings.hotkeys.assign(newHotkey, (res) => {
      console.log('[settings-manager] hotkeys.assign result:', JSON.stringify(res));
    });
  } catch (e) {
    console.error('[settings-manager] failed to assign hotkey:', e);
  }
}

function toggleSettingsWindow() {
  overwolf.windows.obtainDeclaredWindow('settings_ui', (r) => {
    if (r && r.status === 'success') {
      const winId = r.window.id;
      overwolf.windows.getWindowState(winId, (stateRes) => {
        if (stateRes && stateRes.status === 'success') {
          const stateName = stateRes.window_state;
          if (stateName === 'minimized' || stateName === 'closed' || stateName === 'hidden') {
            overwolf.windows.restore(winId, () => {});
          } else {
            overwolf.windows.minimize(winId, () => {});
          }
        } else {
          overwolf.windows.restore(winId, () => {});
        }
      });
    }
  });
}

function onHotkeyPress(r) {
  if (r && r.name === 'toggle_settings_ui') {
    console.log('[settings-manager] toggle_settings_ui hotkey pressed!');
    toggleSettingsWindow();
  }
}

function main() {
  loadState();
  startWsServer();

  // Register Settings Manager's own settings schema
  registerApp({
    app: "Settings (API)",
    icon: "img/icon_256.png",
    settings: [
      {
        key: "toggle_settings_ui",
        label: "Toggle UI Hotkey",
        description: "Global hotkey to show or hide the Settings Manager dashboard.",
        type: "hotkey",
        category: "General",
        default: "Ctrl+Shift+S"
      },
      {
        key: "autoLaunch",
        label: "Start with Overwolf",
        description: "Automatically start Settings Manager when the Overwolf client starts.",
        type: "checkbox",
        category: "Lifecycle",
        default: true
      },
      {
        key: "closeOnGameExit",
        label: "Close on Game Exit",
        description: "Shut down Settings Manager automatically when all games are closed.",
        type: "checkbox",
        category: "Lifecycle",
        default: false
      }
    ]
  });

  try { overwolf.extensions.setInfo(state.apps); } catch (e) {}

  // Auto-start Notifications service on Settings Manager startup
  overwolf.extensions.getExtensions((r) => {
    if (r && r.extensions) {
      const notif = r.extensions.find(e => e.meta && e.meta.name === 'Notifications (API)');
      if (notif) {
        overwolf.extensions.getRunningState(notif.id, (stateRes) => {
          if (stateRes && !stateRes.isRunning) {
            console.log('[settings-manager] Auto-launching Notifications service');
            overwolf.extensions.launch(notif.id, { background: true });
          }
        });
      }
    }
  });

  // Sync hotkey on startup from Overwolf
  try {
    overwolf.settings.hotkeys.get((res) => {
      if (res && res.globals) {
        const hk = res.globals.find(h => h.name === 'toggle_settings_ui');
        if (hk && hk.binding) {
          console.log('[settings-manager] sync hotkey from overwolf:', hk.binding);
          const sm = state.apps['Settings (API)'];
          if (sm && sm.values) {
            sm.values.toggle_settings_ui = hk.binding;
            saveState();
          }
        }
      }
    });
  } catch (e) {
    console.error('[settings-manager] failed to get hotkeys:', e);
  }

  // Register hotkey pressed listener
  try {
    overwolf.settings.hotkeys.onPressed.removeListener(onHotkeyPress);
    overwolf.settings.hotkeys.onPressed.addListener(onHotkeyPress);
  } catch (e) {
    console.error('[settings-manager] failed to register hotkey listener:', e);
  }

  overwolf.extensions.onAppLaunchTriggered.removeListener(handleLaunch);
  overwolf.extensions.onAppLaunchTriggered.addListener(handleLaunch);
}

main();
