/**
 * MiniMap.js — Mapa Leaflet embebido en el panel derecho.
 *
 * Altura total 120px. Tiles OSM con filtro CSS dark.
 * Marcador circleMarker en coordenadas de Reus, ES.
 * Sin controles, sin interacción — solo contexto geográfico.
 *
 * Inicializado en el paso 4 de init() en main.js.
 * No tiene subscripciones al EventBus.
 */

import L from 'leaflet';

// Coordenadas de la planta demo — Reus, Cataluña, ES
const PLANT_LAT = 41.1189;
const PLANT_LNG = 1.2445;
const ZOOM = 13;

const MiniMap = {
  /** @type {L.Map | null} */
  _map: null,

  /**
   * Inicializa el mapa Leaflet en #minimap-container.
   * Llamar en el paso 4 de init() en main.js.
   */
  init() {
    const container = document.getElementById('minimap-container');
    if (!container) {
      if (import.meta.env.DEV) {
        console.warn('MiniMap: no se encontró #minimap-container');
      }
      return;
    }

    // El contenedor necesita altura explícita para que Leaflet lo renderice
    container.style.height = '100%';

    this._map = L.map(container, {
      zoomControl:       false,
      attributionControl: false,
      scrollWheelZoom:   false,
      dragging:          false,
      doubleClickZoom:   false,
      touchZoom:         false,
      keyboard:          false,
      boxZoom:           false,
    });

    // Tiles OSM con filtro CSS dark — sin tiles propietarios ni de pago
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      className: 'map-tiles-dark',
      maxZoom: 19,
    }).addTo(this._map);

    this._map.setView([PLANT_LAT, PLANT_LNG], ZOOM);

    // Marcador circleMarker — color azul (acción/referencia, no estado de proceso)
    L.circleMarker([PLANT_LAT, PLANT_LNG], {
      radius:      4,
      color:       '#3b82f6',
      fillColor:   '#3b82f6',
      fillOpacity: 1,
      weight:      0,
    }).addTo(this._map);

    // Invalidar el tamaño después de que el DOM esté completamente pintado
    // Leaflet necesita esto cuando el contenedor no tiene dimensiones en el momento del init
    setTimeout(() => {
      if (this._map) this._map.invalidateSize();
    }, 100);
  },

  /**
   * Limpieza. Llamar si se desmonta la app.
   */
  destroy() {
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
  },
};

export default MiniMap;