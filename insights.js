/* ==========================================================================
   RESCUEPRIORITY - ANALYTICS / GRAPHS
   ----------------------------------------------------------------------
   Reuses the existing `database` instance from script.js (so this does NOT
   initialize a second Firebase app). It DOES set up its own read-only
   onValue() listener on /incidents — deliberately, not via a cross-module
   live-binding import — because relying on script.js's internal `incidents`
   variable proved unreliable (the Incident Log, which reads that variable
   directly inside script.js, stayed in sync; this file, reading it through
   an ES import, did not always see updates). A dedicated listener here is
   simpler to reason about and guaranteed to match Firebase's actual state.
   /incidents already has ".read: true" in the Firebase rules, so this needs
   no rule changes.

   script.js dispatches one plain DOM event this file listens for:
     - "rp:analytics-view-activated" -> fired the moment the Analytics tab
                                         is opened (so charts are built with
                                         correct canvas dimensions the first
                                         time, instead of while hidden)
========================================================================== */

import { database } from "./script.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const incidentsRootRef = ref(database, "incidents");
let incidents = [];

function setupIncidentsListener() {
    onValue(
        incidentsRootRef,
        (snapshot) => {
            const data = snapshot.val() || {};
            incidents = Object.keys(data).map(key => ({ key, ...data[key] }));
            refreshAnalytics();
            buildOrUpdateHomeCharts();
        },
        (error) => {
            console.error("[analytics listener] Firebase read failed:", error.code, error.message);
        }
    );
}

/* ==========================================================================
   CHART INSTANCES (created once, then updated in place)
========================================================================== */
const charts = {
    frequency: null,
    classroom: null,
    hour: null,
    weekday: null,
    status: null,
    homeClassroom: null,
    homeStatus: null
};

let chartsBuilt = false;
let homeChartsBuilt = false;
let currentPeriod = "daily";

/* ==========================================================================
   THEME COLORS (read from the existing CSS variables in style.css so this
   file never hard-codes a palette that could drift from the rest of the app)
========================================================================== */
function themeColor(varName, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
}

function getPalette() {
    return {
        pink: themeColor("--accent-pink", "#C85A86"),
        pinkDark: themeColor("--accent-pink-dark", "#9F3F68"),
        pinkSoft: themeColor("--accent-pink-soft", "#F3E2E9"),
        pinkLightest: themeColor("--accent-pink-lightest", "#FAF3F6"),
        safe: themeColor("--status-safe", "#3F8F6B"),
        warning: themeColor("--status-warning", "#B5762B"),
        emergency: themeColor("--status-emergency", "#C93D52"),
        textPrimary: themeColor("--text-primary", "#30252B"),
        textSecondary: themeColor("--text-secondary", "#756970"),
        border: themeColor("--border-color", "#E6D5DC"),
        fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif"
    };
}

/* ==========================================================================
   DATA ROBUSTNESS
   Filters raw incident records down to entries analytics can safely use.
   Never throws — a malformed record is simply excluded, not fatal.
========================================================================== */
function getValidIncidents() {
    if (!Array.isArray(incidents)) return [];

    return incidents.filter(inc => {
        if (!inc || typeof inc !== "object") return false;
        const ts = Number(inc.timestamp);
        return Number.isFinite(ts) && ts > 0;
    });
}

function safeClassroomName(inc) {
    return (inc.classroom && String(inc.classroom).trim()) || "Unknown";
}

function safeStatus(inc) {
    return inc.status === "Active" || inc.status === "Resolved" ? inc.status : "Unknown";
}

/* ==========================================================================
   KPI CALCULATIONS
========================================================================== */
function computeKpis(validIncidents) {
    const total = validIncidents.length;
    const active = validIncidents.filter(inc => safeStatus(inc) === "Active").length;
    const resolved = validIncidents.filter(inc => safeStatus(inc) === "Resolved").length;

    const resolutionDurations = validIncidents
        .filter(inc => safeStatus(inc) === "Resolved" && Number.isFinite(Number(inc.resolvedAt)) && Number(inc.resolvedAt) > Number(inc.timestamp))
        .map(inc => Number(inc.resolvedAt) - Number(inc.timestamp));

    let avgResolutionLabel = "Not enough data";

    if (resolutionDurations.length > 0) {
        const avgMs = resolutionDurations.reduce((sum, d) => sum + d, 0) / resolutionDurations.length;
        const avgMinutes = avgMs / 60000;

        if (avgMinutes < 60) {
            avgResolutionLabel = `${avgMinutes.toFixed(1)} min`;
        } else {
            const hours = Math.floor(avgMinutes / 60);
            const mins = Math.round(avgMinutes % 60);
            avgResolutionLabel = `${hours}h ${mins}m`;
        }
    }

    return { total, active, resolved, avgResolutionLabel };
}

function renderKpis(kpis) {
    setText("kpi-total-incidents", kpis.total);
    setText("kpi-active-incidents", kpis.active);
    setText("kpi-resolved-incidents", kpis.resolved);
    setText("kpi-avg-resolution", kpis.avgResolutionLabel);
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

/* ==========================================================================
   INCIDENT FREQUENCY OVER TIME (Daily / Weekly / Monthly)
========================================================================== */
function buildFrequencySeries(validIncidents, period) {
    const now = new Date();
    const buckets = new Map(); // label -> count, insertion-ordered oldest -> newest

    function dayKey(d) {
        return d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // YYYY-MM-DD, sortable
    }
    function dayLabel(d) {
        return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" });
    }
    function weekLabel(d) {
        return `Wk of ${d.toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" })}`;
    }
    function monthKey(d) {
        return d.toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Manila" }).slice(0, 7);
    }
    function monthLabel(d) {
        return d.toLocaleDateString("en-PH", { month: "short", year: "numeric", timeZone: "Asia/Manila" });
    }

    if (period === "monthly") {
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            buckets.set(monthKey(d), { label: monthLabel(d), count: 0 });
        }
        validIncidents.forEach(inc => {
            const d = new Date(Number(inc.timestamp));
            const key = monthKey(d);
            if (buckets.has(key)) buckets.get(key).count++;
        });
    } else if (period === "weekly") {
        const msPerWeek = 7 * 24 * 60 * 60 * 1000;
        const startOfThisWeek = new Date(now);
        startOfThisWeek.setHours(0, 0, 0, 0);
        startOfThisWeek.setDate(startOfThisWeek.getDate() - startOfThisWeek.getDay());

        const weekStarts = [];
        for (let i = 7; i >= 0; i--) {
            weekStarts.push(new Date(startOfThisWeek.getTime() - i * msPerWeek));
        }
        weekStarts.forEach(ws => buckets.set(ws.getTime(), { label: weekLabel(ws), count: 0 }));

        validIncidents.forEach(inc => {
            const ts = Number(inc.timestamp);
            for (let i = weekStarts.length - 1; i >= 0; i--) {
                if (ts >= weekStarts[i].getTime()) {
                    buckets.get(weekStarts[i].getTime()).count++;
                    break;
                }
            }
        });
    } else {
        // daily — last 14 days
        for (let i = 13; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            buckets.set(dayKey(d), { label: dayLabel(d), count: 0 });
        }
        validIncidents.forEach(inc => {
            const d = new Date(Number(inc.timestamp));
            const key = dayKey(d);
            if (buckets.has(key)) buckets.get(key).count++;
        });
    }

    const entries = [...buckets.values()];
    return {
        labels: entries.map(e => e.label),
        data: entries.map(e => e.count)
    };
}

/* ==========================================================================
   BY CLASSROOM
========================================================================== */
function buildClassroomSeries(validIncidents) {
    const counts = new Map();
    validIncidents.forEach(inc => {
        const name = safeClassroomName(inc);
        counts.set(name, (counts.get(name) || 0) + 1);
    });

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    return {
        labels: sorted.map(([name]) => name),
        data: sorted.map(([, count]) => count)
    };
}

/* ==========================================================================
   BY HOUR (0-23, Asia/Manila local hour)
========================================================================== */
function buildHourSeries(validIncidents) {
    const counts = new Array(24).fill(0);

    validIncidents.forEach(inc => {
        const d = new Date(Number(inc.timestamp));
        const hourStr = d.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "Asia/Manila" });
        const hour = parseInt(hourStr, 10) % 24;
        if (Number.isInteger(hour) && hour >= 0 && hour < 24) counts[hour]++;
    });

    const labels = counts.map((_, hour) => {
        const suffix = hour < 12 ? "AM" : "PM";
        const display = hour % 12 === 0 ? 12 : hour % 12;
        return `${display} ${suffix}`;
    });

    return { labels, data: counts };
}

/* ==========================================================================
   BY WEEKDAY (Sunday -> Saturday, Asia/Manila local day)
========================================================================== */
function buildWeekdaySeries(validIncidents) {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const counts = new Array(7).fill(0);

    validIncidents.forEach(inc => {
        const d = new Date(Number(inc.timestamp));
        const weekdayStr = d.toLocaleString("en-US", { weekday: "long", timeZone: "Asia/Manila" });
        const index = dayNames.indexOf(weekdayStr);
        if (index >= 0) counts[index]++;
    });

    return { labels: dayNames, data: counts };
}

/* ==========================================================================
   STATUS DISTRIBUTION
========================================================================== */
function buildStatusSeries(validIncidents) {
    const active = validIncidents.filter(inc => safeStatus(inc) === "Active").length;
    const resolved = validIncidents.filter(inc => safeStatus(inc) === "Resolved").length;
    return { labels: ["Active", "Resolved"], data: [active, resolved] };
}

/* ==========================================================================
   EMPTY-STATE HELPERS
========================================================================== */
function toggleEmptyNote(id, isEmpty) {
    const note = document.getElementById(id);
    if (note) note.classList.toggle("hidden", !isEmpty);
}

/* ==========================================================================
   CHART BUILD / UPDATE
   Charts are created once (chartsBuilt flag) and updated in place afterward
   — this keeps Firebase-driven re-renders cheap and avoids flicker.
========================================================================== */
function buildOrUpdateCharts() {
    const validIncidents = getValidIncidents();

    // KPIs never depend on Chart.js — render them first, unconditionally,
    // so a blocked/failed CDN never blanks out the numbers.
    renderKpis(computeKpis(validIncidents));

    if (typeof Chart === "undefined") {
        // Chart.js failed to load (e.g. CDN blocked on this network).
        // KPIs above still rendered; skip only the graphs themselves.
        return;
    }

    const palette = getPalette();

    const freq = buildFrequencySeries(validIncidents, currentPeriod);
    const classroom = buildClassroomSeries(validIncidents);
    const hour = buildHourSeries(validIncidents);
    const weekday = buildWeekdaySeries(validIncidents);
    const status = buildStatusSeries(validIncidents);

    toggleEmptyNote("chart-frequency-empty", validIncidents.length === 0);
    toggleEmptyNote("chart-classroom-empty", validIncidents.length === 0);
    toggleEmptyNote("chart-hour-empty", validIncidents.length === 0);
    toggleEmptyNote("chart-weekday-empty", validIncidents.length === 0);
    toggleEmptyNote("chart-status-empty", validIncidents.length === 0);

    Chart.defaults.font.family = palette.fontFamily;
    Chart.defaults.color = palette.textSecondary;

    if (!chartsBuilt) {
        // Defensive: if a chart instance somehow already exists on one of
        // these canvases (e.g. a duplicate build call slipped through),
        // destroy it first — Chart.js throws if you construct a new chart
        // on a canvas that's already in use.
        ["chart-frequency", "chart-classroom", "chart-hour", "chart-weekday", "chart-status"].forEach(id => {
            const canvas = document.getElementById(id);
            const existing = canvas && Chart.getChart(canvas);
            if (existing) existing.destroy();
        });

        charts.frequency = new Chart(document.getElementById("chart-frequency"), {
            type: "line",
            data: {
                labels: freq.labels,
                datasets: [{
                    label: "Incidents",
                    data: freq.data,
                    borderColor: palette.pink,
                    backgroundColor: palette.pinkSoft,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 3,
                    pointBackgroundColor: palette.pink
                }]
            },
            options: baseLineOptions(palette)
        });

        charts.classroom = new Chart(document.getElementById("chart-classroom"), {
            type: "bar",
            data: {
                labels: classroom.labels,
                datasets: [{ label: "Incidents", data: classroom.data, backgroundColor: palette.pink, borderRadius: 4 }]
            },
            options: baseBarOptions(palette, true)
        });

        charts.hour = new Chart(document.getElementById("chart-hour"), {
            type: "bar",
            data: {
                labels: hour.labels,
                datasets: [{ label: "Incidents", data: hour.data, backgroundColor: palette.pinkDark, borderRadius: 3 }]
            },
            options: baseBarOptions(palette, false)
        });

        charts.weekday = new Chart(document.getElementById("chart-weekday"), {
            type: "bar",
            data: {
                labels: weekday.labels,
                datasets: [{ label: "Incidents", data: weekday.data, backgroundColor: palette.pink, borderRadius: 4 }]
            },
            options: baseBarOptions(palette, false)
        });

        charts.status = new Chart(document.getElementById("chart-status"), {
            type: "doughnut",
            data: {
                labels: status.labels,
                datasets: [{
                    data: status.data,
                    backgroundColor: [palette.emergency, palette.safe],
                    borderColor: palette.border,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } }
                }
            }
        });

        chartsBuilt = true;
    } else {
        updateDataset(charts.frequency, freq.labels, freq.data);
        updateDataset(charts.classroom, classroom.labels, classroom.data);
        updateDataset(charts.hour, hour.labels, hour.data);
        updateDataset(charts.weekday, weekday.labels, weekday.data);
        updateDataset(charts.status, status.labels, status.data);
    }
}

/* ==========================================================================
   HOME DASHBOARD CHARTS
   A small preview pair (Incidents by Classroom + Status Overview) shown on
   the Home/Dashboard view, in the same style as the reference screenshot.
   The Dashboard is visible on page load (unlike Analytics), so these are
   built immediately rather than waiting for a "view activated" event.
========================================================================== */
function isDashboardViewVisible() {
    const view = document.getElementById("dashboard-view");
    return !!view && !view.classList.contains("hidden");
}

function buildOrUpdateHomeCharts() {
    if (typeof Chart === "undefined") return;

    // Dashboard is no longer the view visible on page load (Command Center
    // is). Chart.js sizes a new chart to its canvas's current pixel
    // dimensions, so building it for the first time while the canvas is
    // display:none would leave it permanently 0x0 — same issue already
    // solved for Analytics via isAnalyticsViewVisible(). Once built, later
    // updates are just data swaps and are safe to run while hidden.
    if (!homeChartsBuilt && !isDashboardViewVisible()) return;

    const validIncidents = getValidIncidents();
    const palette = getPalette();

    const classroom = buildClassroomSeries(validIncidents);
    const status = buildStatusSeries(validIncidents);

    toggleEmptyNote("chart-home-classroom-empty", validIncidents.length === 0);
    toggleEmptyNote("chart-home-status-empty", validIncidents.length === 0);

    Chart.defaults.font.family = palette.fontFamily;
    Chart.defaults.color = palette.textSecondary;

    if (!homeChartsBuilt) {
        ["chart-home-classroom", "chart-home-status"].forEach(id => {
            const canvas = document.getElementById(id);
            const existing = canvas && Chart.getChart(canvas);
            if (existing) existing.destroy();
        });

        const classroomCanvas = document.getElementById("chart-home-classroom");
        if (classroomCanvas) {
            charts.homeClassroom = new Chart(classroomCanvas, {
                type: "bar",
                data: {
                    labels: classroom.labels,
                    datasets: [{ label: "Incidents", data: classroom.data, backgroundColor: palette.pink, borderRadius: 4 }]
                },
                options: baseBarOptions(palette, true)
            });
        }

        const statusCanvas = document.getElementById("chart-home-status");
        if (statusCanvas) {
            charts.homeStatus = new Chart(statusCanvas, {
                type: "doughnut",
                data: {
                    labels: status.labels,
                    datasets: [{
                        data: status.data,
                        backgroundColor: [palette.emergency, palette.safe],
                        borderColor: palette.border,
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: "62%",
                    plugins: {
                        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } }
                    }
                }
            });
        }

        homeChartsBuilt = true;
    } else {
        updateDataset(charts.homeClassroom, classroom.labels, classroom.data);
        updateDataset(charts.homeStatus, status.labels, status.data);
    }
}

function updateDataset(chart, labels, data) {
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.update();
}

function baseLineOptions(palette) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { display: false }, ticks: { font: { size: 10 } } },
            y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } }, grid: { color: palette.border } }
        }
    };
}

function baseBarOptions(palette, horizontalLabelsOnly) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: {
                grid: { display: false },
                ticks: { font: { size: 10 }, autoSkip: horizontalLabelsOnly, maxRotation: horizontalLabelsOnly ? 45 : 0 }
            },
            y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } }, grid: { color: palette.border } }
        }
    };
}

/* ==========================================================================
   VISIBILITY GUARD
   Chart.js sizes a new chart to its canvas's current pixel dimensions. If a
   chart is first created while the Analytics tab is hidden (display:none),
   the canvas is 0x0 and the chart stays invisible forever, even after the
   tab is opened. So: never build charts for the first time while hidden —
   only update KPI text (cheap, no layout needed) until the tab is actually
   visible.
========================================================================== */
function isAnalyticsViewVisible() {
    const view = document.getElementById("analytics-view");
    return !!view && !view.classList.contains("hidden");
}

function refreshAnalytics() {
    if (!chartsBuilt && !isAnalyticsViewVisible()) {
        renderKpis(computeKpis(getValidIncidents()));
        return;
    }
    buildOrUpdateCharts();
}

function setupPeriodControl() {
    const select = document.getElementById("analytics-period-select");
    if (!select) return;

    select.value = currentPeriod;
    select.addEventListener("change", () => {
        currentPeriod = select.value;
        buildOrUpdateCharts();
    });
}

function setupRefreshButton() {
    const button = document.getElementById("btn-analytics-refresh");
    if (button) {
        button.addEventListener("click", refreshAnalytics);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    setupPeriodControl();
    setupRefreshButton();
    setupIncidentsListener();

    // Chart.js (loaded in index.html) tries three CDNs in sequence — that
    // can finish loading AFTER this module has already run once with Chart
    // undefined. If/when it does finish, build the charts at that point.
    window.addEventListener("rp:chartjs-loaded", () => {
        buildOrUpdateCharts();
        buildOrUpdateHomeCharts();
    });

    // Build charts (with correct canvas size) the first time the tab is opened,
    // and force a resize on every subsequent open — a hidden -> visible CSS
    // flip doesn't fire a window resize event, so Chart.js won't notice its
    // canvas now has real dimensions unless told explicitly.
    window.addEventListener("rp:analytics-view-activated", () => {
        refreshAnalytics();
        requestAnimationFrame(() => {
            Object.values(charts).forEach(chart => chart && chart.resize());
        });
    });

    window.addEventListener("rp:dashboard-view-activated", () => {
        buildOrUpdateHomeCharts();
        requestAnimationFrame(() => {
            if (charts.homeClassroom) charts.homeClassroom.resize();
            if (charts.homeStatus) charts.homeStatus.resize();
        });
    });
});
