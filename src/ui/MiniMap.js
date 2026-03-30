/**
 * MiniMap.js — Mapa Leaflet embebido en el panel derecho.
 *
 * Altura total 120px (100px en móvil). Tiles OSM con filtro CSS dark.
 * Marcador circleMarker en coordenadas de Reus, ES.
 * Sin controles, sin interacción — solo contexto geográfico.
 *
 * Inicializado en el paso 4 de init() en main.js.
 * No tiene subscripciones al EventBus.
 *
 * Responsive: usa ResizeObserver para invalidar el mapa cuando
 * el contenedor cambia de tamaño (panel móvil open/close).
 */

import L from 'leaflet';

// Coordenadas de la planta demo — Reus, Cataluña, ES
const PLANT_LAT = 41.1189;
const PLANT_LNG = 1.2445;
const ZOOM = 13;

const MiniMap = {
  /** @type {L.Map | null} */
  _map: null,

  /** @type {ResizeObserver | null} */
  _resizeObserver: null,

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
      zoomControl:        false,
      attributionControl: false,
      scrollWheelZoom:    false,
      dragging:           false,
      doubleClickZoom:    false,
      touchZoom:          false,
      keyboard:           false,
      boxZoom:            false,
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

    // Invalidar el tamaño después de que el DOM esté completamente pintado.
    // Leaflet necesita esto cuando el contenedor no tiene dimensiones en el momento del init.
    setTimeout(() => {
      this._invalidate();
    }, 100);

    // ResizeObserver — invalida el mapa cada vez que el contenedor
    // cambia de tamaño. Cubre los casos de:
    //   - Apertura del panel bottom sheet en móvil
    //   - Resize de ventana en desktop
    //   - Transición CSS de apertura/cierre del panel
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        // Pequeño debounce para no disparar durante la transición entera
        if (this._resizeTimer) clearTimeout(this._resizeTimer);
        this._resizeTimer = setTimeout(() => {
          this._invalidate();
        }, 50);
      });
      this._resizeObserver.observe(container);

      // También observar el panel padre — en móvil el contenedor
      // puede tener dimensiones 0 mientras el panel está cerrado
      const panel = document.getElementById('panel-minimap');
      if (panel) this._resizeObserver.observe(panel);
    }

    // Fallback: escuchar resize de ventana por si ResizeObserver no está disponible
    this._onWindowResize = () => {
      if (this._resizeTimer) clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this._invalidate(), 100);
    };
    window.addEventListener('resize', this._onWindowResize);
  },

  /**
   * Invalida el tamaño del mapa si el contenedor tiene dimensiones válidas.
   * Llamar manualmente desde MobileTabBar cuando se abre el panel.
   */
  invalidate() {
    this._invalidate();
  },

  /**
   * @private
   */
  _invalidate() {
    if (!this._map) return;

    const container = document.getElementById('minimap-container');
    if (!container) return;

    // Solo invalidar si el contenedor es visible y tiene dimensiones reales
    const { offsetWidth, offsetHeight } = container;
    if (offsetWidth > 0 && offsetHeight > 0) {
      this._map.invalidateSize({ animate: false });
    }
  },

  /**
   * Limpieza. Llamar si se desmonta la app.
   */
  destroy() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._onWindowResize) {
      window.removeEventListener('resize', this._onWindowResize);
      this._onWindowResize = null;
    }
    if (this._resizeTimer) {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = null;
    }
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
  },
};

export default MiniMap;