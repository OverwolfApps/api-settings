// Settings Manager — Background Controller
//
// Hosts a local HTTP server on port 61235.
// Other Overwolf apps can POST their settings schemas here to register them,
// and GET their current settings values.

const PORT = 61235;

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
    overwolf.extensions.setInfo(state.apps);
  } catch (e) {
    console.error('[settings-manager] failed to save state:', e);
  }
}

// --- HTTP Server ---------------------------------------------------------------------------
function startServer() {
  stopServer();
  overwolf.web.createServer(PORT, (info) => {
    if (!info || info.status === 'error' || !info.server) {
      console.error(`[settings-manager] server fail on :${PORT} — ${info && info.error}`);
      return;
    }
    state.server = info.server;
    state.server.onRequest.removeListener(onRequest);
    state.server.onRequest.addListener(onRequest);
    state.server.listen((r) => {
      console.log(`[settings-manager] HTTP server listening on :${PORT}: ${JSON.stringify(r)}`);
    });
  });
}

function stopServer() {
  try {
    if (state.server) {
      state.server.onRequest.removeListener(onRequest);
      state.server.close();
    }
  } catch {}
  state.server = null;
}

// onRequest parses the HTTP requests. Since Overwolf WebServer automatically returns CORS 200,
// external apps will just fetch fire-and-forget. However, since they need settings values,
// they can also write/read values.
function onRequest(info) {
  try {
    if (!info || !info.url) return;
    const urlObj = new URL(info.url);
    const path = urlObj.pathname;
    const params = urlObj.searchParams;

    console.log(`[settings-manager] request: ${path} content:`, info.content);

    if (path === '/register' && info.content) {
      const data = JSON.parse(info.content);
      if (data && data.app) {
        registerApp(data);
      }
    } else if (path === '/set' && info.content) {
      const data = JSON.parse(info.content);
      const appName = params.get('app') || (data && data.app);
      if (appName && data && data.values) {
        updateSettingsValues(appName, data.values);
      }
    }
  } catch (e) {
    console.error('[settings-manager] bad request:', e && e.message);
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

  state.apps[name] = {
    app: name,
    icon: data.icon || '',
    settings: schema,
    values: values,
    updatedAt: Date.now()
  };

  saveState();
  console.log(`[settings-manager] registered app "${name}" with ${schema.length} settings`);

  // Notify settings_ui window if open
  overwolf.windows.sendMessage('settings_ui', 'app-registered', { app: name }, () => {});
}

// Update settings values for an app (e.g. programmatically from the app itself)
function updateSettingsValues(appName, patch) {
  const app = state.apps[appName];
  if (!app) return;

  app.values = { ...app.values, ...patch };
  app.updatedAt = Date.now();
  saveState();

  console.log(`[settings-manager] updated values for "${appName}":`, patch);

  // Notify settings_ui window if open
  overwolf.windows.sendMessage('settings_ui', 'values-changed', { app: appName, values: app.values }, () => {});
}

function main() {
  loadState();
  startServer();
  try { overwolf.extensions.setInfo(state.apps); } catch (e) {}

  // Open the settings UI once on launch
  overwolf.windows.obtainDeclaredWindow('settings_ui', (r) => {
    if (r && r.status === 'success') {
      overwolf.windows.restore(r.window.id, () => {});
    }
  });
}

main();
