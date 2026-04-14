/**
 * StartupModal.js — Diálogo de selección de fuente de datos al arrancar.
 *
 * Se muestra UNA VEZ al inicio, antes de que haya ningún dato.
 * El usuario elige explícitamente entre:
 *   - Simulación     → datos sintéticos generados localmente
 *   - Datos reales   → abre ConfigModal para conectar al broker MQTT
 *
 * PRINCIPIO: el modo simulación NUNCA se activa automáticamente.
 *            El usuario siempre elige de forma explícita.
 *
 * El modal bloquea la interacción con la app hasta que se hace una elección.
 * No tiene botón "cerrar" — se debe elegir un modo.
 */

import DataSourceManager from '../core/DataSourceManager.js';
import ConfigModal       from './ConfigModal.js';

// ─── CSS embebido ─────────────────────────────────────────────────────────────

const STYLES = `
#startup-overlay {
  position: fixed;
  inset: 0;
  background: rgba(11, 12, 14, 0.92);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: startup-fade-in 0.25s ease;
}

@keyframes startup-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

#startup-modal {
  background: #111316;
  border: 1px solid #ffffff18;
  border-radius: 12px;
  padding: 32px;
  width: 480px;
  max-width: calc(100vw - 32px);
  display: flex;
  flex-direction: column;
  gap: 24px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.6);
}

#startup-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

#startup-logo-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.startup-logo-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #3b82f6;
}

#startup-app-name {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 11px;
  font-weight: 500;
  color: #52565f;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

#startup-title {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 18px;
  font-weight: 500;
  color: #f0f0f0;
  margin: 0;
}

#startup-subtitle {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 12px;
  color: #a0a4ad;
  margin: 0;
}

#startup-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.startup-card {
  background: #16181c;
  border: 1px solid #ffffff0f;
  border-radius: 8px;
  padding: 18px 16px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  font-family: 'IBM Plex Sans', sans-serif;
}

.startup-card:hover {
  border-color: #ffffff28;
  background: #1c1f24;
}

.startup-card:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

.startup-card-icon {
  font-size: 20px;
  line-height: 1;
}

.startup-card-title {
  font-size: 13px;
  font-weight: 500;
  color: #f0f0f0;
}

.startup-card-desc {
  font-size: 11px;
  color: #52565f;
  line-height: 1.5;
}

.startup-card-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  margin-top: 2px;
  width: fit-content;
}

.startup-card--sim .startup-card-badge {
  background: #f59e0b14;
  color: #f59e0b;
  border: 1px solid #f59e0b28;
}

.startup-card--mqtt .startup-card-badge {
  background: #22c55e12;
  color: #22c55e;
  border: 1px solid #22c55e28;
}

.startup-card--sim:hover {
  border-color: #f59e0b40;
}

.startup-card--mqtt:hover {
  border-color: #22c55e40;
}

#startup-footer {
  font-size: 10px;
  color: #52565f;
  text-align: center;
  line-height: 1.5;
}
`;

// ─── StartupModal ─────────────────────────────────────────────────────────────

const StartupModal = {
  _overlay: null,

  /**
   * Muestra el modal de selección de modo.
   * Resuelve la promesa cuando el usuario ha elegido.
   * @returns {Promise<void>}
   */
  show() {
    return new Promise((resolve) => {
      this._inject();
      this._build(resolve);
    });
  },

  _inject() {
    if (document.getElementById('startup-styles')) return;
    const style = document.createElement('style');
    style.id = 'startup-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  },

  _build(resolve) {
    const overlay = document.createElement('div');
    overlay.id = 'startup-overlay';

    overlay.innerHTML = `
      <div id="startup-modal" role="dialog" aria-modal="true" aria-labelledby="startup-title">

        <div id="startup-header">
          <div id="startup-logo-row">
            <span class="startup-logo-dot"></span>
            <span id="startup-app-name">WTP Digital Twin</span>
          </div>
          <h2 id="startup-title">Select data source</h2>
          <p id="startup-subtitle">
            Choose how to populate the dashboard. You can change this at any time from the toolbar.
          </p>
        </div>

        <div id="startup-cards">

          <button class="startup-card startup-card--sim" id="startup-sim" tabindex="0">
            <span class="startup-card-icon">▶</span>
            <span class="startup-card-title">Simulation</span>
            <span class="startup-card-desc">
              Synthetic sensor data generated locally. No external connection required.
            </span>
            <span class="startup-card-badge">Offline · No setup</span>
          </button>

          <button class="startup-card startup-card--mqtt" id="startup-mqtt" tabindex="0">
            <span class="startup-card-icon">📡</span>
            <span class="startup-card-title">Real MQTT Data</span>
            <span class="startup-card-desc">
              Connect to a live MQTT broker. Configure broker URL and credentials.
            </span>
            <span class="startup-card-badge">Requires broker</span>
          </button>

        </div>

        <p id="startup-footer">
          Simulation data is completely isolated from real data.<br>
          Switching modes clears all readings, history, and alerts.
        </p>

      </div>
    `;

    document.body.appendChild(overlay);
    this._overlay = overlay;

    // ── Handlers ──────────────────────────────────────────────────────────
    const onSim = () => {
      this._dismiss();
      DataSourceManager.startSimulation();
      resolve();
    };

    const onMqtt = () => {
      this._dismiss();
      // Abrir ConfigModal — el usuario configura y conecta desde ahí
      ConfigModal.open();
      resolve();
    };

    overlay.querySelector('#startup-sim').addEventListener('click', onSim);
    overlay.querySelector('#startup-mqtt').addEventListener('click', onMqtt);

    // Focus en la primera opción
    setTimeout(() => overlay.querySelector('#startup-sim')?.focus(), 50);
  },

  _dismiss() {
    if (!this._overlay) return;
    this._overlay.style.transition = 'opacity 0.2s ease';
    this._overlay.style.opacity    = '0';
    setTimeout(() => {
      this._overlay?.remove();
      this._overlay = null;
    }, 200);
  },
};

export default StartupModal;
