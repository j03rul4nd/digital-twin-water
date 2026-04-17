/**
 * ReportTemplates.js — Metadata for the 3 predefined report templates.
 *
 * Pure data — no rendering logic. Each template declares its id, label,
 * description, default section overrides, and a static preview thumbnail
 * described as a layout spec for the canvas preview in ReportPanel.
 */

export const TEMPLATES = {
  SHIFT_HANDOVER: {
    id:          'SHIFT_HANDOVER',
    label:       'Shift Handover',
    icon:        '🔄',
    description: 'Compact operational summary for shift change. Sensor status table, active & resolved alerts, KPI row, and optional signature line. Fits 1–2 pages.',
    useCases:    ['Operator handover every 8 hours', 'Quick operational status'],
    pages:       '1–2 pages',
    sectionDefaults: {
      includeKPIs:                true,
      includeActiveAlerts:        true,
      includeResolvedAlerts:      true,
      includeSensorCharts:        false,
      includeStatisticalAnalysis: false,
      includeCostAnalysis:        false,
      includeSignatureLine:       true,
      maxSensorsToChart:          0,
    },
  },

  INCIDENT_REPORT: {
    id:          'INCIDENT_REPORT',
    label:       'Incident Report',
    icon:        '⚠️',
    description: 'Post-mortem forensic report. Sensor trend charts for the incident window, alert timeline, statistical deviation analysis, and cost impact estimate.',
    useCases:    ['Post-incident documentation', 'Regulatory evidence', 'Root cause analysis'],
    pages:       '3–6 pages',
    sectionDefaults: {
      includeKPIs:                true,
      includeActiveAlerts:        true,
      includeResolvedAlerts:      true,
      includeSensorCharts:        true,
      includeStatisticalAnalysis: true,
      includeCostAnalysis:        true,
      includeSignatureLine:       false,
      maxSensorsToChart:          6,
    },
  },

  EXECUTIVE_SUMMARY: {
    id:          'EXECUTIVE_SUMMARY',
    label:       'Executive Summary',
    icon:        '📊',
    description: 'Monthly KPI dashboard for management review or regulatory submission. OEE, throughput, cost per m³, sensor trends, top alerts, period comparison.',
    useCases:    ['Monthly board meeting', 'Regulatory audit', 'Commercial demo'],
    pages:       '2–3 pages',
    sectionDefaults: {
      includeKPIs:                true,
      includeActiveAlerts:        false,
      includeResolvedAlerts:      false,
      includeSensorCharts:        true,
      includeStatisticalAnalysis: false,
      includeCostAnalysis:        true,
      includeSignatureLine:       false,
      maxSensorsToChart:          3,
    },
  },
};

export const TEMPLATE_ORDER = ['SHIFT_HANDOVER', 'INCIDENT_REPORT', 'EXECUTIVE_SUMMARY'];
