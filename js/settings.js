// Settings Manager — Dashboard UI Logic
let selfWinId = null;
let currentApp = null;
let recordingHotkeyEl = null;

const els = {
  closeBtn: document.getElementById('close-btn'),
  refreshBtn: document.getElementById('refresh-btn'),
  searchInput: document.getElementById('search-input'),
  appsList: document.getElementById('apps-list'),
  settingsHeader: document.getElementById('settings-header'),
  settingsForm: document.getElementById('settings-form'),
  exportBtn: document.getElementById('export-btn'),
  importBtn: document.getElementById('import-btn'),
};

// Resolve self window ID and bind window drag
overwolf.windows.getCurrentWindow((r) => {
  if (r.status === 'success') selfWinId = r.window.id;
});

els.closeBtn.onclick = () => {
  if (selfWinId) overwolf.windows.hide(selfWinId);
};

els.refreshBtn.onclick = () => {
  refreshUI();
};

els.exportBtn.onclick = () => {
  const state = getBgState();
  if (!state || !state.apps) return;
  const exportData = {};
  for (const [appName, app] of Object.entries(state.apps)) {
    exportData[appName] = app.values;
  }
  const json = JSON.stringify(exportData, null, 2);
  overwolf.utils.placeOnClipboard(json);
  
  const original = els.exportBtn.innerHTML;
  els.exportBtn.innerHTML = '✅';
  setTimeout(() => els.exportBtn.innerHTML = original, 1000);
};

els.importBtn.onclick = () => {
  overwolf.utils.getFromClipboard((data) => {
    try {
      const parsed = JSON.parse(data);
      const bg = overwolf.windows.getMainWindow();
      if (!bg || !bg.updateSettingsValues) return;
      
      let importedCount = 0;
      for (const [appName, values] of Object.entries(parsed)) {
        if (typeof values === 'object' && !Array.isArray(values)) {
          bg.updateSettingsValues(appName, values);
          importedCount++;
        }
      }
      
      if (importedCount > 0) {
        const original = els.importBtn.innerHTML;
        els.importBtn.innerHTML = '✅';
        setTimeout(() => els.importBtn.innerHTML = original, 1000);
      } else {
        throw new Error("No valid app configurations found");
      }
    } catch (e) {
      console.error('Failed to import settings:', e);
      const original = els.importBtn.innerHTML;
      els.importBtn.innerHTML = '❌';
      setTimeout(() => els.importBtn.innerHTML = original, 1000);
    }
  });
};

els.searchInput.oninput = () => {
  renderAppsList();
};

// Handle window message updates from background
overwolf.windows.onMessageReceived.addListener((msg) => {
  if (msg.id === 'app-registered' || msg.id === 'values-changed') {
    refreshUI(msg.content && msg.content.app);
  }
});

// Retrieve background state
function getBgState() {
  try {
    const bg = overwolf.windows.getMainWindow();
    return bg && bg.settingsState;
  } catch (e) {
    console.error('Failed to get background window:', e);
    return null;
  }
}

function refreshUI(preferredActiveApp = null) {
  const state = getBgState();
  if (!state || !state.apps) return;

  const prevActive = preferredActiveApp || currentApp;
  renderAppsList();

  // If previous active app still exists, re-select it; otherwise select first
  const appKeys = Object.keys(state.apps);
  if (appKeys.length > 0) {
    if (prevActive && state.apps[prevActive]) {
      selectApp(prevActive);
    } else {
      selectApp(appKeys[0]);
    }
  } else {
    currentApp = null;
    els.settingsHeader.innerHTML = `
      <div class="welcome-banner">
        <h2>Welcome to Settings Manager</h2>
        <p>Centralized configuration dashboard for your Overwolf applications.</p>
      </div>`;
    els.settingsForm.style.display = 'none';
  }
}

function renderAppsList() {
  const state = getBgState();
  if (!state || !state.apps) return;

  const query = els.searchInput.value.toLowerCase().trim();
  const listEl = els.appsList;
  listEl.innerHTML = '';

  const apps = Object.values(state.apps).filter(app => 
    app.app.toLowerCase().includes(query)
  );

  if (apps.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No matching apps found.</div>';
    return;
  }

  apps.forEach(app => {
    const el = document.createElement('div');
    el.className = 'app-item' + (currentApp === app.app ? ' active' : '');
    
    const iconUrl = app.icon || '../img/icon_256.png';
    el.innerHTML = `
      <img src="${iconUrl}" onerror="this.onerror=null; this.src='../img/icon_256.png';" />
      <span class="app-name">${escapeHtml(app.app)}</span>
    `;

    el.onclick = () => {
      selectApp(app.app);
    };

    listEl.appendChild(el);
  });
}

function selectApp(appName) {
  currentApp = appName;
  
  // Highlight in list
  const items = els.appsList.querySelectorAll('.app-item');
  const state = getBgState();
  const app = state.apps[appName];

  items.forEach(item => {
    const name = item.querySelector('.app-name').textContent;
    if (name === appName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Render header
  const iconUrl = app.icon || '../img/icon_256.png';
  els.settingsHeader.innerHTML = `
    <div class="active-app-header">
      <img src="${iconUrl}" onerror="this.onerror=null; this.src='../img/icon_256.png';" />
      <h2>${escapeHtml(app.app)} Settings</h2>
    </div>
  `;

  // Render form
  renderSettingsForm(app);
}

function renderSettingsForm(app) {
  const formEl = els.settingsForm;
  formEl.innerHTML = '';
  formEl.style.display = 'block';

  // Group settings by category
  const categories = {};
  app.settings.forEach(s => {
    const catName = s.category || 'General';
    if (!categories[catName]) categories[catName] = [];
    categories[catName].push(s);
  });

  // Render each category section
  for (const catName in categories) {
    const section = document.createElement('div');
    section.className = 'category-section';
    section.innerHTML = `<div class="category-title">${escapeHtml(catName)}</div>`;

    categories[catName].forEach(s => {
      const card = document.createElement('div');
      card.className = 'setting-card';
      card.dataset.key = s.key;

      const val = app.values[s.key] !== undefined ? app.values[s.key] : (s.default !== undefined ? s.default : '');

      let controlHtml = '';

      switch (s.type) {
        case 'checkbox':
          controlHtml = `
            <label class="switch">
              <input type="checkbox" ${val ? 'checked' : ''} />
              <span class="slider-toggle"></span>
            </label>`;
          break;

        case 'slider':
          const unit = s.unit || '';
          controlHtml = `
            <div class="slider-container">
              <input type="range" min="${s.min || 0}" max="${s.max || 100}" step="${s.step || 1}" value="${val}" />
              <span class="slider-val">${val}${unit}</span>
            </div>`;
          break;

        case 'color':
          controlHtml = `
            <div class="color-picker-container">
              <input type="color" value="${val || '#ffffff'}" />
              <input type="text" value="${val || '#ffffff'}" style="width: 80px;" />
            </div>`;
          break;

        case 'hotkey':
          controlHtml = `
            <button class="hotkey-btn">${escapeHtml(val || 'None')}</button>
          `;
          break;

        case 'select':
          const optionsHtml = (s.options || []).map(opt => {
            const optVal = typeof opt === 'object' ? opt.value : opt;
            const optLabel = typeof opt === 'object' ? opt.label : opt;
            return `<option value="${escapeAttr(optVal)}" ${optVal === val ? 'selected' : ''}>${escapeHtml(optLabel)}</option>`;
          }).join('');
          controlHtml = `<select>${optionsHtml}</select>`;
          break;

        case 'textarea':
          controlHtml = `<textarea>${escapeHtml(val)}</textarea>`;
          break;

        case 'number':
          controlHtml = `<input type="number" min="${s.min !== undefined ? s.min : ''}" max="${s.max !== undefined ? s.max : ''}" step="${s.step !== undefined ? s.step : '1'}" value="${val}" />`;
          break;

        case 'text':
        default:
          controlHtml = `<input type="text" value="${escapeAttr(val)}" />`;
          break;
      }

      card.innerHTML = `
        <div class="setting-info">
          <div class="setting-label">${escapeHtml(s.label || s.key)}</div>
          ${s.description ? `<div class="setting-desc">${escapeHtml(s.description)}</div>` : ''}
        </div>
        <div class="setting-control">${controlHtml}</div>
      `;

      // Bind input changes
      bindControlEvents(card, s, app);
      section.appendChild(card);
    });

    formEl.appendChild(section);
  }
}

function bindControlEvents(card, s, app) {
  const control = card.querySelector('.setting-control');
  const key = s.key;

  const update = (newVal) => {
    try {
      const bg = overwolf.windows.getMainWindow();
      if (bg && typeof bg.updateSettingsValues === 'function') {
        bg.updateSettingsValues(app.app, { [key]: newVal });
      } else {
        app.values[key] = newVal;
      }
    } catch (e) {
      console.error('Failed to save updated setting:', e);
      app.values[key] = newVal;
    }
  };

  if (s.type === 'checkbox') {
    const input = control.querySelector('input');
    input.onchange = () => update(input.checked);
  } else if (s.type === 'slider') {
    const range = control.querySelector('input[type="range"]');
    const valSpan = control.querySelector('.slider-val');
    const unit = s.unit || '';
    range.oninput = () => {
      valSpan.textContent = range.value + unit;
    };
    range.onchange = () => {
      update(parseInt(range.value, 10));
    };
  } else if (s.type === 'color') {
    const colorInput = control.querySelector('input[type="color"]');
    const textInput = control.querySelector('input[type="text"]');
    
    colorInput.oninput = () => {
      textInput.value = colorInput.value;
    };
    colorInput.onchange = () => {
      update(colorInput.value);
    };

    textInput.onchange = () => {
      let val = textInput.value.trim();
      if (/^#[0-9A-F]{6}$/i.test(val)) {
        colorInput.value = val;
        update(val);
      } else {
        textInput.value = colorInput.value; // revert
      }
    };
  } else if (s.type === 'hotkey') {
    const btn = control.querySelector('.hotkey-btn');
    btn.onclick = () => {
      if (recordingHotkeyEl) {
        recordingHotkeyEl.classList.remove('recording');
        recordingHotkeyEl.textContent = recordingHotkeyEl.dataset.prevVal || 'None';
      }
      recordingHotkeyEl = btn;
      btn.dataset.prevVal = btn.textContent;
      btn.classList.add('recording');
      btn.textContent = 'Press keys...';
    };
  } else if (s.type === 'select') {
    const select = control.querySelector('select');
    select.onchange = () => update(select.value);
  } else if (s.type === 'textarea') {
    const textarea = control.querySelector('textarea');
    textarea.onchange = () => update(textarea.value);
  } else if (s.type === 'number') {
    const input = control.querySelector('input');
    input.onchange = () => {
      const val = parseFloat(input.value);
      update(Number.isNaN(val) ? null : val);
    };
  } else {
    const input = control.querySelector('input');
    input.onchange = () => update(input.value);
  }
}

// Hotkey Recording Global listener
document.addEventListener('keydown', (e) => {
  if (!recordingHotkeyEl) return;

  // Ignore solo modifier keys
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

  e.preventDefault();
  e.stopPropagation();

  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  
  // Format key name nicely
  let keyName = e.key;
  if (keyName === ' ') keyName = 'Space';
  else if (keyName.length === 1) keyName = keyName.toUpperCase();
  parts.push(keyName);

  const hotkeyStr = parts.join('+');
  
  const card = recordingHotkeyEl.closest('.setting-card');
  const key = card.dataset.key;
  const state = getBgState();
  const app = state.apps[currentApp];

  recordingHotkeyEl.textContent = hotkeyStr;
  recordingHotkeyEl.classList.remove('recording');
  recordingHotkeyEl = null;

  // Save the setting
  try {
    const bg = overwolf.windows.getMainWindow();
    if (bg && typeof bg.updateSettingsValues === 'function') {
      bg.updateSettingsValues(app.app, { [key]: hotkeyStr });
    } else {
      app.values[key] = hotkeyStr;
    }
  } catch (err) {
    app.values[key] = hotkeyStr;
  }
});

// Cancel recording if clicking elsewhere
document.addEventListener('mousedown', (e) => {
  if (!recordingHotkeyEl) return;
  if (!e.target.closest('.hotkey-btn')) {
    recordingHotkeyEl.classList.remove('recording');
    recordingHotkeyEl.textContent = recordingHotkeyEl.dataset.prevVal || 'None';
    recordingHotkeyEl = null;
  }
});

// Drag support
document.querySelector('.app-header').addEventListener('mousedown', (e) => {
  if (e.target.closest('button')) return;
  if (selfWinId) overwolf.windows.dragMove(selfWinId);
});

// HTML escaping helpers
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

// Initial paint
refreshUI();
