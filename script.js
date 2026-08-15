/* ==========================================================================
   RESCUEPRIORITY - MCNHS Emergency Operations Center Dashboard
   JavaScript Controller — Navigation Views + Permanent Incident Logging
========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getDatabase,
    ref,
    set,
    update,
    push,
    onValue,
    runTransaction,
    get,
    remove
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

/* ==========================================================================
   FIREBASE CONFIGURATION (unchanged — existing project)
========================================================================== */
const firebaseConfig = {
    apiKey: "AIzaSyDHPzeyaEtVvEvnH1Va81i24tpiCX8Gx-8",
    authDomain: "school-alert-system-8f211.firebaseapp.com",
    databaseURL: "https://school-alert-system-8f211-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "school-alert-system-8f211",
    storageBucket: "school-alert-system-8f211.firebasestorage.app",
    messagingSenderId: "568204675808",
    appId: "1:568204675808:web:1ca3536d31b7dc5db45e85",
    measurementId: "G-JT58NQCRMQ"
};

const firebaseApp = initializeApp(firebaseConfig);
export const database = getDatabase(firebaseApp);

/* ==========================================================================
   FIREBASE PATHS
   ----------------------------------------------------------------------
   classrooms/{facilityId}          -> CURRENT state (what's happening now)
       .emergency          : boolean
       .activeIncidentKey  : string | null   (which incidents/ record is open)

   incidents/{pushKey}              -> HISTORICAL record (permanent)
       .incidentNumber     : "Emergency #001"
       .timestamp          : number (epoch ms, when triggered)
       .classroom          : string (facility display name)
       .status             : "Active" | "Resolved"
       .resolvedAt         : number (epoch ms) | null

   counters/lastIncidentNumber      -> integer, never resets, source of #001/#002/...
========================================================================== */
const classroomsRootRef = ref(database, "classrooms");
const incidentsRootRef = ref(database, "incidents");
const lastIncidentNumberRef = ref(database, "counters/lastIncidentNumber");

/* ==========================================================================
   GLOBAL STATE
========================================================================== */
let selectedFacilityId = null;

// classroomsState[facilityId] = { emergency: bool, activeIncidentKey: string|null }
let classroomsState = {};

// incidents = array of { key, incidentNumber, timestamp, classroom, status, resolvedAt }
// Exported (live binding) so analytics.js can read the same in-memory data
// without opening a second Firebase listener on /incidents.
export let incidents = [];

let selectedIncidentId = null;      // incident key currently shown in the detail panel
let resolveSelectionKey = null;     // incident key chosen inside the Resolve Emergency modal

/* ==========================================================================
   SCHOOL FACILITY DATABASE (unchanged — authoritative, do not edit)
========================================================================== */
const SCHOOL_FACILITIES = [
    /* ===============================
       TOP WING (Left to Right)
    =============================== */
    { id: "top-fr-1", name: "F.R.", adviser: "Maintenance", section: "Facility Room", zone: "Top Wing", adviserImage: "advisor1.png" },
    { id: "top-fr-2", name: "F.R.", adviser: "Maintenance", section: "Facility Room", zone: "Top Wing", adviserImage: "advisor2.png" },
    { id: "top-9e", name: "9-E", adviser: "", section: "Grade 9-E", zone: "Top Wing", adviserImage: "advisor3.png" },
    { id: "top-10b", name: "10-B", adviser: "", section: "Grade 10-B", zone: "Top Wing", adviserImage: "advisor4.png" },
    { id: "top-10c", name: "10-C", adviser: "", section: "Grade 10-C", zone: "Top Wing", adviserImage: "advisor5.png" },
    { id: "top-10d", name: "10-D", adviser: "", section: "Grade 10-D", zone: "Top Wing", adviserImage: "advisor6.png" },
    { id: "top-cr-1", name: "C.R.", adviser: "Maintenance", section: "Comfort Room", zone: "Top Wing", adviserImage: "advisor7.png" },
    { id: "top-fr-3", name: "F.R.", adviser: "Maintenance", section: "Facility Room", zone: "Top Wing", adviserImage: "advisor8.png" },
    { id: "top-8f", name: "8-F", adviser: "", section: "Grade 8-F", zone: "Top Wing", adviserImage: "advisor9.png" },
    { id: "top-9c", name: "9-C", adviser: "", section: "Grade 9-C", zone: "Top Wing", adviserImage: "advisor10.png" },
    { id: "top-8b", name: "8-B", adviser: "", section: "Grade 8-B", zone: "Top Wing", adviserImage: "advisor11.png" },
    { id: "top-8d", name: "8-D", adviser: "", section: "Grade 8-D", zone: "Top Wing", adviserImage: "advisor12.png" },
    { id: "top-lib", name: "LIB.", adviser: "Librarian", section: "Library", zone: "Top Wing", adviserImage: "advisor13.png" },
    { id: "top-clinic", name: "CLINIC", adviser: "School Nurse", section: "Medical Clinic", zone: "Top Wing", adviserImage: "advisor14.png" },
    { id: "top-fr-4", name: "F.R.", adviser: "Maintenance", section: "Facility Room", zone: "Top Wing", adviserImage: "advisor15.png" },

    /* ===============================
       LEFT WING (Top to Bottom)
    =============================== */
    { id: "left-10e", name: "10-E", adviser: "", section: "Grade 10-E", zone: "Left Wing", adviserImage: "advisor16.png" },
    { id: "left-9b", name: "9-B", adviser: "", section: "Grade 9-B", zone: "Left Wing", adviserImage: "advisor17.png" },
    { id: "left-9d", name: "9-D", adviser: "", section: "Grade 9-D", zone: "Left Wing", adviserImage: "advisor18.png" },
    { id: "left-8e", name: "8-E", adviser: "", section: "Grade 8-E", zone: "Left Wing", adviserImage: "advisor19.png" },
    { id: "left-fr", name: "F.R.", adviser: "Maintenance", section: "Facility Room", zone: "Left Wing", adviserImage: "advisor20.png" },
    { id: "left-canteen", name: "CANTEEN", adviser: "Canteen Manager", section: "Food Services", zone: "Left Wing", adviserImage: "advisor21.png" },
    { id: "left-cr", name: "C.R.", adviser: "Maintenance", section: "Comfort Room", zone: "Left Wing", adviserImage: "advisor22.png" },
    { id: "left-garnet", name: "11-GARNET", adviser: "", section: "Grade 11 Garnet", zone: "Left Wing", adviserImage: "advisor23.png" },
    { id: "left-fedorite", name: "12-FEDORITE", adviser: "", section: "Grade 12 Fedorite", zone: "Left Wing", adviserImage: "advisor24.png" },
    { id: "left-7a", name: "7-A", adviser: "", section: "Grade 7-A", zone: "Left Wing", adviserImage: "advisor25.png" },
    { id: "left-euclase", name: "12-EUCLASE", adviser: "", section: "Grade 12 Euclase", zone: "Left Wing", adviserImage: "advisor26.png" },
    { id: "left-ebony", name: "11-EBONY", adviser: "", section: "Grade 11 Ebony", zone: "Left Wing", adviserImage: "advisor27.png" },

    /* ===============================
       RIGHT WING (Top to Bottom)
    =============================== */
    { id: "right-8c", name: "8-C", adviser: "", section: "Grade 8-C", zone: "Right Wing", adviserImage: "advisor28.png" },
    { id: "right-8a", name: "8-A", adviser: "", section: "Grade 8-A", zone: "Right Wing", adviserImage: "advisor29.png" },
    { id: "right-he", name: "H.E.", adviser: "HE Teacher", section: "Home Economics", zone: "Right Wing", adviserImage: "advisor30.png" },
    { id: "right-7f", name: "7-F", adviser: "", section: "Grade 7-F", zone: "Right Wing", adviserImage: "advisor31.png" },
    { id: "right-7c", name: "7-C", adviser: "", section: "Grade 7-C", zone: "Right Wing", adviserImage: "advisor32.png" },
    { id: "right-7e", name: "7-E", adviser: "", section: "Grade 7-E", zone: "Right Wing", adviserImage: "advisor33.png" },
    { id: "right-7b", name: "7-B", adviser: "", section: "Grade 7-B", zone: "Right Wing", adviserImage: "advisor34.png" },
    { id: "right-ssig", name: "SSIG OFFICE", adviser: "SSIG Coordinator", section: "SSIG", zone: "Right Wing", adviserImage: "advisor35.png" },

    /* ===============================
       BOTTOM BLOCK (Left to Right)
    =============================== */
    { id: "bottom-10a", name: "10-A", adviser: "", section: "Grade 10-A", zone: "Bottom Wing", adviserImage: "advisor36.png" },
    { id: "bottom-9a", name: "9-A OFFICE", adviser: "Officer", section: "Office", zone: "Bottom Wing", adviserImage: "advisor37.png" },
    { id: "bottom-po", name: "P. OFFICE", adviser: "Principal", section: "Administration", zone: "Bottom Wing", adviserImage: "advisor38.png" },
    { id: "bottom-7d", name: "7-D", adviser: "", section: "Grade 7-D", zone: "Bottom Wing", adviserImage: "advisor39.png" },

    /* ===============================
       SHS BUILDING BLOCK 1
    =============================== */
    { id: "shs1-sapphire", name: "12-SAPPHIRE", adviser: "", section: "Grade 12 Sapphire", zone: "SHS Building 1", adviserImage: "advisor40.png" },
    { id: "shs1-sci", name: "SCIENCE LAB", adviser: "Science Teacher", section: "Laboratory", zone: "SHS Building 1", adviserImage: "advisor41.png" },
    { id: "shs1-amethyst", name: "12-AMETHYST", adviser: "", section: "Grade 12 Amethyst", zone: "SHS Building 1", adviserImage: "advisor42.png" },
    { id: "shs1-amaranth", name: "11-AMARANTH", adviser: "", section: "Grade 11 Amaranth", zone: "SHS Building 1", adviserImage: "advisor43.png" },
    { id: "shs1-complab", name: "COMP LAB", adviser: "ICT Coordinator", section: "Computer Laboratory", zone: "SHS Building 1", adviserImage: "advisor44.png" },
    { id: "shs1-obsidian", name: "12-OBSIDIAN", adviser: "", section: "Grade 12 Obsidian", zone: "SHS Building 1", adviserImage: "advisor45.png" },
    { id: "shs1-honeydew", name: "11-HONEYDEW", adviser: "", section: "Grade 11 Honeydew", zone: "SHS Building 1", adviserImage: "advisor46.png" },
    { id: "shs1-epidote", name: "12-EPIDOTE", adviser: "", section: "Grade 12 Epidote", zone: "SHS Building 1", adviserImage: "advisor47.png" },

    /* ===============================
       SHS BUILDING BLOCK 2
    =============================== */
    { id: "shs2-fuschia", name: "11-FUSCHIA", adviser: "", section: "Grade 11 Fuschia", zone: "SHS Building 2", adviserImage: "advisor48.png" },
    { id: "shs2-driftwood", name: "11-DRIFTWOOD", adviser: "", section: "Grade 11 Driftwood", zone: "SHS Building 2", adviserImage: "advisor49.png" },
    { id: "shs2-emerald", name: "12-EMERALD", adviser: "", section: "Grade 12 Emerald", zone: "SHS Building 2", adviserImage: "advisor50.png" },
    { id: "shs2-cr1", name: "C.R.", adviser: "Maintenance", section: "Comfort Room", zone: "SHS Building 2", adviserImage: "advisor51.png" },
    { id: "shs2-burgundy", name: "11-BURGUNDY", adviser: "", section: "Grade 11 Burgundy", zone: "SHS Building 2", adviserImage: "advisor52.png" },
    { id: "shs2-bloodstone", name: "12-BLOODSTONE", adviser: "", section: "Grade 12 Bloodstone", zone: "SHS Building 2", adviserImage: "advisor53.png" },
    { id: "shs2-cerulean", name: "11-CERULEAN", adviser: "", section: "Grade 11 Cerulean", zone: "SHS Building 2", adviserImage: "advisor54.png" },
    { id: "shs2-cr2", name: "C.R.", adviser: "Maintenance", section: "Comfort Room", zone: "SHS Building 2", adviserImage: "advisor55.png" }
];

/* ==========================================================================
   PAGE IN/* ==========================================================================
   INITIALIZATION
========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
    initializeDashboard();
});


function initializeDashboard() {
    buildCampusMap();
    setupClock();
    setupClassroomsListener();
    setupIncidentsListener();
    setupButtons();
    setupModal();
    setupResolveModal();
    setupNavigation();
    setupSidebarToggle();
    setupQuickActions();
    setupIncidentViewControls();
    initCampusWatchCarousel();
    updateStatistics();

    // Clear All Incident Logs button
    const clearIncidentButton = document.getElementById("btn-clear-all-incidents");

    if (clearIncidentButton) {
        clearIncidentButton.addEventListener("click", clearAllIncidentLogs);
    }
}

/* ==========================================================================
   BUILD CAMPUS MAP (unchanged — orientation, zones, IDs preserved exactly)
========================================================================== */
function buildCampusMap() {
    const top = document.getElementById("wing-top");
    const left = document.getElementById("wing-left");
    const right = document.getElementById("wing-right");
    const bottom = document.getElementById("wing-bottom");

    const shs1Tier1 = document.getElementById("shs1-tier-1");
    const shs1Tier2 = document.getElementById("shs1-tier-2");
    const shs2Tier1 = document.getElementById("shs2-tier-1");
    const shs2Tier2 = document.getElementById("shs2-tier-2");

    if (!top || !left || !right || !bottom) return;

    clearBlueprintWings();

    SCHOOL_FACILITIES.forEach(facility => {
        const card = createRoomCard(facility);

        if (facility.zone === "Top Wing") {
            top.appendChild(card);
        } else if (facility.zone === "Left Wing") {
            left.appendChild(card);
        } else if (facility.zone === "Right Wing") {
            right.appendChild(card);
        } else if (facility.zone === "Bottom Wing") {
            bottom.appendChild(card);
        } else if (facility.zone === "SHS Building 1") {
            if (["shs1-sapphire", "shs1-sci", "shs1-amethyst", "shs1-amaranth"].includes(facility.id)) {
                shs1Tier1.appendChild(card);
            } else {
                shs1Tier2.appendChild(card);
            }
        } else if (facility.zone === "SHS Building 2") {
            if (["shs2-fuschia", "shs2-driftwood", "shs2-emerald", "shs2-cr1"].includes(facility.id)) {
                shs2Tier1.appendChild(card);
            } else {
                shs2Tier2.appendChild(card);
            }
        }
    });
}

function clearBlueprintWings() {
    const ids = ["wing-top", "wing-left", "wing-right", "wing-bottom", "shs1-tier-1", "shs1-tier-2", "shs2-tier-1", "shs2-tier-2"];
    ids.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.innerHTML = "";
    });
}

function createRoomCard(facility) {
    const card = document.createElement("div");
    card.className = "room-card";
    card.dataset.id = facility.id;

    card.innerHTML = `
        <span class="room-number">${facility.name}</span>
        <span class="room-status-badge">SAFE</span>
    `;

    card.addEventListener("click", () => {
        openRoomModal(facility.id);
    });

    return card;
}

/* ==========================================================================
   LIVE CLOCK (unchanged, Philippine local time)
========================================================================== */
function setupClock() {
    function updateClock() {
        const now = new Date();
        const time = now.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Manila" });
        const date = now.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
        const hour = parseInt(now.toLocaleString("en-PH", { hour: "2-digit", hour12: false, timeZone: "Asia/Manila" }), 10);

        const timeElement = document.getElementById("live-time");
        const dateElement = document.getElementById("live-date");
        const greetingElement = document.getElementById("greeting-text");

        if (timeElement) timeElement.textContent = time;
        if (dateElement) dateElement.textContent = date;

        if (greetingElement) {
            let greeting = "Good evening";
            if (hour < 12) greeting = "Good morning";
            else if (hour < 18) greeting = "Good afternoon";
            greetingElement.textContent = `${greeting}, Admin`;
        }
    }

    updateClock();
    setInterval(updateClock, 1000);
}

/* ==========================================================================
   FIREBASE LISTENER — classrooms/ (CURRENT emergency state, display only)
   This listener never creates incidents. It only paints the map and keeps
   classroomsState in sync so the Resolve Emergency modal and modal buttons
   know which rooms are currently flagged.
========================================================================== */
function setupClassroomsListener() {
    onValue(
        classroomsRootRef,
        (snapshot) => {
            const data = snapshot.val() || {};
            classroomsState = data;

            SCHOOL_FACILITIES.forEach(facility => {
                const entry = classroomsState[facility.id];
                const isActive = !!(entry && entry.emergency);
                updateRoomStatus(facility.id, isActive ? "THREAT" : "SAFE");
            });

            updateStatistics();
            updateSystemStatusWidgets();
            updateCampusStatusCommand();
            updateSystemStatusFullList();
            refreshCarouselLiveData();

            // Keep an open room modal's buttons in sync if that room's state changed
            if (selectedFacilityId) {
                refreshModalButtonsForFacility(selectedFacilityId);
            }
        },
        (error) => {
            // Surface Firebase read errors (e.g. permission/rules issues)
            // instead of leaving the map silently frozen.
            console.error("[classrooms listener] Firebase read failed:", error.code, error.message);
        }
    );
}

/* ==========================================================================
   FIREBASE LISTENER — incidents/ (HISTORICAL, permanent)
========================================================================== */
function setupIncidentsListener() {
    onValue(
        incidentsRootRef,
        (snapshot) => {
            const data = snapshot.val() || {};
            incidents = Object.keys(data).map(key => ({ key, ...data[key] }));

            renderIncidentFolderList();
            updateIncidentsStat();
            renderCommandRecentIncidents();

            if (selectedIncidentId !== null) {
                const current = incidents.find(inc => inc.key === selectedIncidentId);
                if (current) renderIncidentDetail(current);
            }

            // Keep the Resolve Emergency modal's list live if it's open
            const resolveModal = document.getElementById("resolve-modal");
            if (resolveModal && !resolveModal.classList.contains("hidden")) {
                renderResolveOptions();
            }

            // Let analytics.js (loaded independently) know fresh data is in.
            // Kept as a plain DOM event so this file doesn't need to import
            // or know anything about the analytics module.
            window.dispatchEvent(new CustomEvent("rp:incidents-updated"));
        },
        (error) => {
            console.error("[incidents listener] Firebase read failed:", error.code, error.message);
        }
    );
}

/* ==========================================================================
   TEST ALERT BUTTON
   Simulates what the ESP32 does: picks a currently-safe classroom and raises
   it. This lets the whole pipeline (incident creation -> log -> resolve) be
   tested without hardware.
========================================================================== */
function setupButtons() {
    const testButton = document.getElementById("btn-trigger-test");
    if (testButton) {
        testButton.addEventListener("click", () => {
            const candidates = SCHOOL_FACILITIES.filter(f => {
                const entry = classroomsState[f.id];
                return !(entry && entry.emergency);
            });

            if (candidates.length === 0) {
                console.warn("All classrooms already have an active emergency.");
                return;
            }

            const facility = candidates[Math.floor(Math.random() * candidates.length)];
            raiseClassroomEmergency(facility).catch(error => console.error(error));
        });
    }
}

/* ==========================================================================
   INCIDENT NUMBERING — atomic counter via Firebase transaction
========================================================================== */
async function getNextIncidentNumber() {
    const result = await runTransaction(lastIncidentNumberRef, (current) => {
        return (current || 0) + 1;
    });
    return result.snapshot.val();
}

function formatIncidentNumber(n) {
    return `Emergency #${String(n).padStart(3, "0")}`;
}

/* ==========================================================================
   RAISE A NEW EMERGENCY FOR A CLASSROOM
   Creates the permanent incident record AND the current-state flag together,
   so a classroom is never left "emergency: true" without a matching incident
   (and vice versa). This is the website-side equivalent of what the ESP32
   firmware does directly against Firebase.
========================================================================== */
async function raiseClassroomEmergency(facility) {
    const existing = classroomsState[facility.id];
    if (existing && existing.emergency) {
        // Already active — do not create a duplicate incident.
        return;
    }

    const incidentNumber = await getNextIncidentNumber();
    const now = Date.now();

    const newIncidentRef = push(incidentsRootRef);
    const incidentData = {
        incidentNumber: formatIncidentNumber(incidentNumber),
        timestamp: now,
        classroom: facility.name,
        status: "Active",
        resolvedAt: null
    };

    await set(newIncidentRef, incidentData);

    await update(ref(database, `classrooms/${facility.id}`), {
        emergency: true,
        activeIncidentKey: newIncidentRef.key
    });
}

/* ==========================================================================
   RESOLVE A SPECIFIC INCIDENT (selected by the user)
========================================================================== */
async function resolveIncidentByKey(incidentKey, resolutionReason) {
    const incident = incidents.find(inc => inc.key === incidentKey);
    if (!incident || incident.status !== "Active") return;

    const now = Date.now();

    const trimmedReason = (resolutionReason || "").trim();

    const resolutionUpdate = {
        status: "Resolved",
        resolvedAt: now
    };

    // resolutionReason is optional in the Firebase rules — only send it
    // when the user actually typed something, so we don't write empty strings.
    if (trimmedReason.length > 0) {
        resolutionUpdate.resolutionReason = trimmedReason;
    }

    await update(ref(database, `incidents/${incidentKey}`), resolutionUpdate);

    // Find which classroom this incident belongs to (by matching activeIncidentKey)
    // and clear its current-state flag.
    const facilityId = Object.keys(classroomsState).find(
        id => classroomsState[id] && classroomsState[id].activeIncidentKey === incidentKey
    );

    if (facilityId) {
        await update(ref(database, `classrooms/${facilityId}`), {
            emergency: false,
            activeIncidentKey: null
        });
    }
}

/* ==========================================================================
   NAVIGATION — sidebar view switching
   Command Center is the view visible by default in index.html; every other
   .app-view starts with the "hidden" class. Clicking a sidebar item (or a
   Command Center quick-action button) swaps which view is visible and keeps
   the sidebar's active-state highlight in sync.
========================================================================== */
function setupNavigation() {
    const navItems = document.querySelectorAll(".sidebar-nav-item[data-view]");

    navItems.forEach(item => {
        item.addEventListener("click", () => {
            switchView(item.dataset.view);
            closeMobileSidebar();
        });
    });
}

function setupQuickActions() {
    document.querySelectorAll(".quick-action-btn[data-view]").forEach(button => {
        button.addEventListener("click", () => {
            switchView(button.dataset.view);
        });
    });
}

function setupSidebarToggle() {
    const sidebar = document.getElementById("sidebar");
    const toggle = document.getElementById("sidebar-toggle");
    const closeButton = document.getElementById("sidebar-close");
    const backdrop = document.getElementById("sidebar-backdrop");

    if (toggle) {
        toggle.addEventListener("click", () => {
            if (sidebar) sidebar.classList.add("open");
            if (backdrop) backdrop.classList.add("open");
        });
    }
    if (closeButton) closeButton.addEventListener("click", closeMobileSidebar);
    if (backdrop) backdrop.addEventListener("click", closeMobileSidebar);
}

function closeMobileSidebar() {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (sidebar) sidebar.classList.remove("open");
    if (backdrop) backdrop.classList.remove("open");
}

function switchView(viewId) {
    document.querySelectorAll(".app-view").forEach(view => {
        view.classList.toggle("hidden", view.id !== viewId);
    });

    document.querySelectorAll(".sidebar-nav-item[data-view]").forEach(item => {
        item.classList.toggle("active", item.dataset.view === viewId);
    });

    if (viewId === "incident-log-view") {
        showIncidentListPanel();
    }

    if (viewId === "analytics-view") {
        window.dispatchEvent(new CustomEvent("rp:analytics-view-activated"));
    }

    if (viewId === "dashboard-view") {
        window.dispatchEvent(new CustomEvent("rp:dashboard-view-activated"));
    }
}

/* ==========================================================================
   INCIDENT LOG VIEW CONTROLS (list <-> detail)
========================================================================== */
function setupIncidentViewControls() {
    const backButton = document.getElementById("btn-back-to-incidents");
    if (backButton) {
        backButton.addEventListener("click", showIncidentListPanel);
    }
}

function showIncidentListPanel() {
    selectedIncidentId = null;
    const listPanel = document.getElementById("incident-list-panel");
    const detailPanel = document.getElementById("incident-detail-panel");
    if (listPanel) listPanel.classList.remove("hidden");
    if (detailPanel) detailPanel.classList.add("hidden");
}

function showIncidentDetailPanel() {
    const listPanel = document.getElementById("incident-list-panel");
    const detailPanel = document.getElementById("incident-detail-panel");
    if (listPanel) listPanel.classList.add("hidden");
    if (detailPanel) detailPanel.classList.remove("hidden");
}

/* ==========================================================================
   INCIDENT LOG — folder list rendering (newest first)
========================================================================== */
function renderIncidentFolderList() {
    const list = document.getElementById("incident-folder-list");
    if (!list) return;

    if (incidents.length === 0) {
        list.innerHTML = `<div class="empty-incident-state">No recorded incidents yet. System operating normally.</div>`;
        return;
    }

    const sorted = [...incidents].sort((a, b) => b.timestamp - a.timestamp);

    list.innerHTML = "";
    sorted.forEach(incident => {
        const card = document.createElement("div");
        card.className = "incident-card";

        const triggeredTime = formatDateTime(incident.timestamp);
        const statusLabel = incident.status;
        const statusClass = `status-${incident.status.toLowerCase()}`;

        card.innerHTML = `
            <div class="incident-card-main">
                <span class="incident-card-id">${incident.incidentNumber}</span>
                <span class="incident-card-sub">${incident.classroom}</span>
                <span class="incident-card-time">${triggeredTime}</span>
            </div>
            <span class="status-pill ${statusClass}">${statusLabel}</span>
        `;

        card.addEventListener("click", () => {
            selectedIncidentId = incident.key;
            renderIncidentDetail(incident);
            showIncidentDetailPanel();
        });

        list.appendChild(card);
    });
}

/* ==========================================================================
   INCIDENT LOG — detail / timeline rendering
   The "timeline" is derived purely from the two stored timestamps
   (timestamp, resolvedAt) — nothing extra is stored in Firebase for it.
========================================================================== */
function renderIncidentDetail(incident) {
    const titleEl = document.getElementById("incident-detail-title");
    const statusBadge = document.getElementById("incident-detail-status-badge");
    const facilityEl = document.getElementById("incident-detail-facility");
    const triggeredEl = document.getElementById("incident-detail-triggered");
    const resolvedEl = document.getElementById("incident-detail-resolved");
    const statusTextEl = document.getElementById("incident-detail-status-text");
    const timelineList = document.getElementById("incident-timeline-list");

    if (titleEl) titleEl.textContent = incident.incidentNumber;

    if (statusBadge) {
        statusBadge.textContent = incident.status;
        statusBadge.className = `status-pill status-${incident.status.toLowerCase()}`;
    }

    if (facilityEl) facilityEl.textContent = incident.classroom;
    if (triggeredEl) triggeredEl.textContent = formatDateTime(incident.timestamp);
    if (resolvedEl) resolvedEl.textContent = incident.resolvedAt ? formatDateTime(incident.resolvedAt) : "--";
    if (statusTextEl) statusTextEl.textContent = incident.status;

    if (timelineList) {
        timelineList.innerHTML = "";

        const events = [
            { timestamp: incident.timestamp, type: "triggered", message: "Emergency triggered" }
        ];
        if (incident.resolvedAt) {
            const resolvedMessage = incident.resolutionReason
                ? `Emergency resolved — ${incident.resolutionReason}`
                : "Emergency resolved";
            events.push({ timestamp: incident.resolvedAt, type: "resolved", message: resolvedMessage });
        }

        events.forEach(event => {
            const li = document.createElement("li");
            li.className = `timeline-event event-${event.type}`;
            li.innerHTML = `
                <span class="timeline-event-time">${formatTime(event.timestamp)}</span>
                <span class="timeline-marker">
                    <span class="timeline-dot"></span>
                    <span class="timeline-line"></span>
                </span>
                <span class="timeline-content">
                    <span class="timeline-event-title">${event.message}</span>
                </span>
            `;
            timelineList.appendChild(li);
        });
    }
}

function formatTime(epochMs) {
    if (!epochMs) return "--";
    return new Date(epochMs).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" });
}

function formatDateTime(epochMs) {
    if (!epochMs) return "--";
    return new Date(epochMs).toLocaleString("en-PH", {
        month: "long", day: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit",
        timeZone: "Asia/Manila"
    });
}
/* ==========================================================================
   INCIDENT LOG — detail / timeline rendering
   The "timeline" is derived purely from the two stored timestamps
   (timestamp, resolvedAt) — nothing extra is stored in Firebase for it.
========================================================================== */

/* ==========================================================================
   INCIDENT LOG — detail / timeline rendering
   The "timeline" is derived purely from the two stored timestamps
   (timestamp, resolvedAt) — nothing extra is stored in Firebase for it.
========================================================================== */

async function clearAllIncidentLogs() {
    const confirmed = window.confirm(
        "CLEAR ALL INCIDENT LOGS?\n\n" +
        "This will permanently delete every recorded incident from Firebase.\n\n" +
        "This action cannot be undone."
    );

    if (!confirmed) return;

    try {
        // Get all incidents currently stored in Firebase
        const snapshot = await get(incidentsRootRef);

        if (!snapshot.exists()) {
            alert("There are no incident logs to clear.");
            return;
        }

        const incidentsData = snapshot.val();

        // Delete each incident individually
        // This works with your current Firebase Rules
        const deletePromises = Object.keys(incidentsData).map((incidentKey) => {
            return remove(ref(database, `incidents/${incidentKey}`));
        });

        await Promise.all(deletePromises);

        // Clear selected incident in the dashboard
        selectedIncidentId = null;
        resolveSelectionKey = null;

        console.log("All incident logs have been cleared.");
        alert("All incident logs have been cleared successfully.");

    } catch (error) {
        console.error("Failed to clear incident logs:", error);
        alert("Failed to clear incident logs. Check the console for details.");
    }
}
/* ==========================================================================
   ROOM MODAL SYSTEM
========================================================================== */
function setupModal() {
    const modal = document.getElementById("room-modal");
    const closeButton = document.getElementById("modal-close");
    const acknowledgeButton = document.getElementById("btn-acknowledge");
    const resolveButton = document.getElementById("btn-resolve");

    if (closeButton) {
        closeButton.addEventListener("click", closeModal);
    }

    if (modal) {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeModal();
        });
    }

    if (acknowledgeButton) {
        // UI-only affordance — acknowledgment is not part of the stored
        // incident schema, so nothing is written to Firebase here.
        acknowledgeButton.addEventListener("click", () => {
            if (acknowledgeButton.disabled) return;
            acknowledgeButton.textContent = "Siren Acknowledged";
            acknowledgeButton.disabled = true;
        });
    }

    if (resolveButton) {
        resolveButton.addEventListener("click", () => {
            if (resolveButton.disabled) return;
            closeModal();
            openResolveModal();
        });
    }
}

function openRoomModal(facilityId) {
    selectedFacilityId = facilityId;
    const facility = SCHOOL_FACILITIES.find(item => item.id === facilityId);
    if (!facility) return;

    const modal = document.getElementById("room-modal");
    const entry = classroomsState[facility.id];
    const isEmergency = !!(entry && entry.emergency);

    document.getElementById("modal-room-title").textContent = facility.name;
    document.getElementById("modal-zone").textContent = facility.zone;
    document.getElementById("modal-adviser").textContent = facility.adviser || "Unassigned";
    document.getElementById("modal-section").textContent = facility.section;
    document.getElementById("modal-priority").textContent = getPriorityLevel(facility.id);
    document.getElementById("modal-type").textContent = isEmergency ? "ACTIVE EMERGENCY" : "SAFE";

    const modalBadge = document.getElementById("modal-status-badge");
    if (modalBadge) {
        modalBadge.textContent = isEmergency ? "EMERGENCY" : "SAFE";
        modalBadge.style.background = isEmergency ? "var(--status-emergency-light)" : "var(--status-safe-light)";
        modalBadge.style.color = isEmergency ? "var(--status-emergency)" : "var(--status-safe)";
        modalBadge.style.border = isEmergency ? "1px solid var(--status-emergency)" : "1px solid var(--status-safe)";
    }

    const preview = document.getElementById("modal-image-container");
    if (preview) {
        preview.innerHTML = `
            <div style="
                width:100%; height:100%;
                position: relative; overflow: hidden; background: var(--accent-pink-lightest);
            ">
                <img src="${facility.adviserImage}" alt="${facility.adviser || 'Adviser'}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'">
            </div>
        `;
    }

    refreshModalButtonsForFacility(facility.id);

    if (modal) modal.classList.remove("hidden");
}

function refreshModalButtonsForFacility(facilityId) {
    const acknowledgeButton = document.getElementById("btn-acknowledge");
    const resolveButton = document.getElementById("btn-resolve");
    const entry = classroomsState[facilityId];
    const isEmergency = !!(entry && entry.emergency);

    if (isEmergency) {
        if (acknowledgeButton) {
            acknowledgeButton.disabled = false;
            acknowledgeButton.textContent = "Acknowledge Siren";
        }
        if (resolveButton) resolveButton.disabled = false;
    } else {
        if (acknowledgeButton) {
            acknowledgeButton.disabled = true;
            acknowledgeButton.textContent = "Acknowledge Siren";
        }
        if (resolveButton) resolveButton.disabled = true;
    }
}

function closeModal() {
    const modal = document.getElementById("room-modal");
    if (modal) modal.classList.add("hidden");
}

function getPriorityLevel(facilityId) {
    const facility = SCHOOL_FACILITIES.find(item => item.id === facilityId);
    if (!facility) return "LOW";

    const criticalRooms = ["CLINIC", "SCIENCE LAB", "COMP LAB", "LIB."];
    return criticalRooms.includes(facility.name) ? "HIGH" : "NORMAL";
}

/* ==========================================================================
   RESOLVE EMERGENCY SELECTION MODAL
========================================================================== */
function setupResolveModal() {
    const closeButton = document.getElementById("resolve-modal-close");
    const cancelButton = document.getElementById("btn-resolve-cancel");
    const confirmButton = document.getElementById("btn-resolve-confirm");
    const modal = document.getElementById("resolve-modal");

    if (closeButton) closeButton.addEventListener("click", closeResolveModal);
    if (cancelButton) cancelButton.addEventListener("click", closeResolveModal);

    if (modal) {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeResolveModal();
        });
    }

    if (confirmButton) {
        confirmButton.addEventListener("click", async () => {
            if (confirmButton.disabled || !resolveSelectionKey) return;
            confirmButton.disabled = true;
            try {
                const reasonInput = document.getElementById("resolve-reason-input");
                const reason = reasonInput ? reasonInput.value : "";
                await resolveIncidentByKey(resolveSelectionKey, reason);
                closeResolveModal();
            } catch (error) {
                console.error("Failed to resolve incident:", error);
                confirmButton.disabled = false;
            }
        });
    }
}

function openResolveModal() {
    resolveSelectionKey = null;
    renderResolveOptions();

    const reasonInput = document.getElementById("resolve-reason-input");
    if (reasonInput) reasonInput.value = "";

    const modal = document.getElementById("resolve-modal");
    if (modal) modal.classList.remove("hidden");
}

function closeResolveModal() {
    resolveSelectionKey = null;

    const reasonInput = document.getElementById("resolve-reason-input");
    if (reasonInput) reasonInput.value = "";

    const modal = document.getElementById("resolve-modal");
    if (modal) modal.classList.add("hidden");
}

function renderResolveOptions() {
    const list = document.getElementById("resolve-options-list");
    const confirmButton = document.getElementById("btn-resolve-confirm");
    if (!list) return;

    const activeIncidents = incidents
        .filter(inc => inc.status === "Active")
        .sort((a, b) => a.timestamp - b.timestamp);

    if (activeIncidents.length === 0) {
        list.innerHTML = `<div class="empty-incident-state">No active emergencies to resolve.</div>`;
        if (confirmButton) confirmButton.disabled = true;
        return;
    }

    list.innerHTML = "";
    activeIncidents.forEach(incident => {
        const option = document.createElement("label");
        option.className = "resolve-option";
        option.innerHTML = `
            <input type="radio" name="resolve-choice" value="${incident.key}">
            <span class="resolve-option-label">${incident.incidentNumber} &mdash; ${incident.classroom}</span>
        `;

        const radio = option.querySelector("input");
        radio.checked = incident.key === resolveSelectionKey;
        radio.addEventListener("change", () => {
            resolveSelectionKey = incident.key;
            if (confirmButton) confirmButton.disabled = false;
        });

        list.appendChild(option);
    });

    if (confirmButton) {
        confirmButton.disabled = !resolveSelectionKey;
    }
}

/* ==========================================================================
   MAP DISPLAY HELPERS
========================================================================== */
function updateRoomStatus(facilityId, status) {
    const card = document.querySelector(`.room-card[data-id="${facilityId}"]`);
    if (!card) return;

    const badge = card.querySelector(".room-status-badge");
    card.classList.remove("status-safe", "status-threat", "status-medical", "status-suspicious", "emergency-active");

    if (status === "SAFE") {
        card.classList.add("status-safe");
        if (badge) badge.textContent = "SAFE";
    } else if (status === "THREAT") {
        // "emergency-active" drives the pink glow/pulse defined in style.css.
        // It is applied purely because classrooms/{facilityId}/emergency is
        // true right now — never hard-coded to a particular facility — and
        // is removed the instant that value flips back to false.
        card.classList.add("status-threat", "emergency-active");
        if (badge) badge.textContent = "EMERGENCY";
    }
}

/* ==========================================================================
   STATISTICS
========================================================================== */
function updateStatistics() {
    const total = SCHOOL_FACILITIES.length;
    let safe = 0;
    let alerts = 0;

    SCHOOL_FACILITIES.forEach(facility => {
        const entry = classroomsState[facility.id];
        if (entry && entry.emergency) {
            alerts++;
        } else {
            safe++;
        }
    });

    const totalElement = document.getElementById("stat-total");
    const safeElement = document.getElementById("stat-safe");
    const alertElement = document.getElementById("stat-alerts");

    if (totalElement) totalElement.textContent = total;
    if (safeElement) safeElement.textContent = safe;
    if (alertElement) alertElement.textContent = alerts;
}

/* ==========================================================================
   COMMAND CENTER — KPI / SYSTEM STATUS / CAMPUS STATUS / RECENT INCIDENTS
   All figures below are derived from the same classroomsState / incidents
   data the rest of the app already uses — nothing here is hard-coded.
========================================================================== */
function getActiveEmergencyCount() {
    return SCHOOL_FACILITIES.reduce((count, facility) => {
        const entry = classroomsState[facility.id];
        return count + ((entry && entry.emergency) ? 1 : 0);
    }, 0);
}

function updateIncidentsStat() {
    const el = document.getElementById("stat-incidents");
    if (el) el.textContent = incidents.length;
}

function updateSystemStatusWidgets() {
    const total = SCHOOL_FACILITIES.length;
    const activeCount = getActiveEmergencyCount();
    const isAlert = activeCount > 0;

    const titleText = isAlert
        ? `${activeCount} Active Emergenc${activeCount === 1 ? "y" : "ies"} Detected`
        : "All Systems Normal";
    const detailText = isAlert
        ? `${activeCount} facilit${activeCount === 1 ? "y requires" : "ies require"} immediate attention`
        : `${total} facilities monitored \u00B7 no active emergencies detected`;
    const iconText = isAlert ? "\u26A0" : "\u2713";

    [
        { card: "system-status-card", icon: "system-status-icon", title: "system-status-title", detail: "system-status-detail" },
        { card: "system-status-card-full", icon: "system-status-icon-full", title: "system-status-title-full", detail: "system-status-detail-full" }
    ].forEach(refs => {
        const card = document.getElementById(refs.card);
        const icon = document.getElementById(refs.icon);
        const title = document.getElementById(refs.title);
        const detail = document.getElementById(refs.detail);

        if (card) card.classList.toggle("status-alert", isAlert);
        if (icon) icon.textContent = iconText;
        if (title) title.textContent = titleText;
        if (detail) detail.textContent = detailText;
    });
}

function updateCampusStatusCommand() {
    const total = SCHOOL_FACILITIES.length;
    const activeCount = getActiveEmergencyCount();
    const safeCount = total - activeCount;

    const safeValue = document.getElementById("cc-safe-value");
    const activeValue = document.getElementById("cc-active-value");
    const totalValue = document.getElementById("cc-total-value");
    const safeBar = document.getElementById("cc-safe-bar");
    const activeBar = document.getElementById("cc-active-bar");

    if (safeValue) safeValue.textContent = safeCount;
    if (activeValue) activeValue.textContent = activeCount;
    if (totalValue) totalValue.textContent = total;
    if (safeBar) safeBar.style.width = `${total ? (safeCount / total) * 100 : 0}%`;
    if (activeBar) activeBar.style.width = `${total ? (activeCount / total) * 100 : 0}%`;
}

function updateSystemStatusFullList() {
    const list = document.getElementById("system-status-full-list");
    if (!list) return;

    const activeFacilities = SCHOOL_FACILITIES.filter(facility => {
        const entry = classroomsState[facility.id];
        return !!(entry && entry.emergency);
    });

    if (activeFacilities.length === 0) {
        list.innerHTML = `<div class="empty-incident-state">No active emergencies. All facilities are safe.</div>`;
        return;
    }

    list.innerHTML = "";
    activeFacilities.forEach(facility => {
        const row = document.createElement("div");
        row.className = "cc-recent-item";
        row.innerHTML = `
            <div class="cc-recent-main">
                <span class="cc-recent-id">${facility.name}</span>
                <span class="cc-recent-sub">${facility.section} &middot; ${facility.zone}</span>
            </div>
            <span class="status-pill status-active">Emergency</span>
        `;
        row.addEventListener("click", () => {
            switchView("campus-map-view");
            openRoomModal(facility.id);
        });
        list.appendChild(row);
    });
}

/* ==========================================================================
   COMMAND CENTER — RECENT INCIDENTS (latest 5, newest first)
========================================================================== */
function renderCommandRecentIncidents() {
    const list = document.getElementById("command-recent-incidents");
    if (!list) return;

    if (incidents.length === 0) {
        list.innerHTML = `<div class="empty-incident-state">No recorded incidents yet.</div>`;
        return;
    }

    const recent = [...incidents].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);

    list.innerHTML = "";
    recent.forEach(incident => {
        const item = document.createElement("div");
        item.className = "cc-recent-item";
        const statusClass = `status-${incident.status.toLowerCase()}`;
        item.innerHTML = `
            <div class="cc-recent-main">
                <span class="cc-recent-id">${incident.incidentNumber}</span>
                <span class="cc-recent-sub">${incident.classroom}</span>
            </div>
            <span class="status-pill ${statusClass}">${incident.status}</span>
        `;
        item.addEventListener("click", () => {
            selectedIncidentId = incident.key;
            switchView("incident-log-view");
            renderIncidentDetail(incident);
            showIncidentDetailPanel();
        });
        list.appendChild(item);
    });
}

/* ==========================================================================
   LIVE CAMPUS UPDATE — "Campus Watch" adviser/facility carousel
   Generated dynamically from SCHOOL_FACILITIES (never hard-coded per-slide
   HTML), so it always stays in sync with the facility database. Facilities
   currently in emergency are sorted to the front so the carousel opens on
   whatever needs attention right now; order is only recomputed when the set
   of active emergencies actually changes, so it never jitters mid-browse.
========================================================================== */
let carouselOrder = [];
let carouselIndex = 0;
let carouselTimer = null;
let carouselEmergencySignature = "";
let carouselAnimating = false;
const CAROUSEL_INTERVAL_MS = 5000;

function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function computeCarouselOrder() {
    const emergencyIds = SCHOOL_FACILITIES
        .filter(f => classroomsState[f.id] && classroomsState[f.id].emergency)
        .map(f => f.id);
    const emergencySet = new Set(emergencyIds);

    const ordered = [
        ...SCHOOL_FACILITIES.filter(f => emergencySet.has(f.id)),
        ...SCHOOL_FACILITIES.filter(f => !emergencySet.has(f.id))
    ];

    return { ordered, signature: emergencyIds.slice().sort().join(",") };
}

function buildFacilitySlideHTML(facility) {
    const entry = classroomsState[facility.id];
    const isEmergency = !!(entry && entry.emergency);
    const initials = facility.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "RP";

    return `
        <div class="carousel-slide-photo">
            <img src="${facility.adviserImage}" alt="${facility.adviser || facility.name}"
                 onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'carousel-avatar-fallback',textContent:'${initials}'}))">
        </div>
        <div class="carousel-slide-info">
            <span class="carousel-alert-banner">&#9888; LIVE CAMPUS ALERT</span>
            <span class="carousel-facility-tag">Facility Spotlight</span>
            <h4>${facility.name}</h4>
            <p class="carousel-section">${facility.section}</p>
            <p class="carousel-zone">${facility.zone}</p>
            <div class="carousel-adviser-row"><span>Adviser</span><strong>${facility.adviser || "Unassigned"}</strong></div>
            <div class="carousel-status-row"><span class="status-dot"></span><strong>${isEmergency ? "EMERGENCY" : "SAFE"}</strong></div>
        </div>
    `;
}

function createSlideElement(facility) {
    const entry = classroomsState[facility.id];
    const isEmergency = !!(entry && entry.emergency);
    const slide = document.createElement("div");
    slide.className = "carousel-slide" + (isEmergency ? " is-emergency" : "");
    slide.innerHTML = buildFacilitySlideHTML(facility);
    return slide;
}

function updateCarouselCounter() {
    const counter = document.getElementById("carousel-counter");
    const fill = document.getElementById("carousel-progress-fill");
    const total = carouselOrder.length || 1;
    if (counter) counter.textContent = `${carouselIndex + 1} / ${total}`;
    if (fill) fill.style.width = `${((carouselIndex + 1) / total) * 100}%`;
}

function showSlideAtIndex(newIndex, direction) {
    const wrap = document.getElementById("carousel-track-wrap");
    if (!wrap || carouselOrder.length === 0) return;

    carouselIndex = ((newIndex % carouselOrder.length) + carouselOrder.length) % carouselOrder.length;
    const facility = carouselOrder[carouselIndex];
    const newSlide = createSlideElement(facility);
    const currentSlide = wrap.querySelector(".carousel-slide");
    const reduceMotion = prefersReducedMotion();

    updateCarouselCounter();

    if (!currentSlide || reduceMotion || !direction) {
        wrap.innerHTML = "";
        wrap.appendChild(newSlide);
        return;
    }

    if (carouselAnimating) {
        // Finish instantly if a transition is already mid-flight so slides
        // never queue up behind each other.
        wrap.innerHTML = "";
        wrap.appendChild(newSlide);
        return;
    }

    carouselAnimating = true;
    newSlide.classList.add(direction === "next" ? "enter-right" : "enter-left");
    wrap.appendChild(newSlide);

    // Force layout so the "enter" transform is applied before we animate it away.
    void newSlide.offsetWidth;

    currentSlide.classList.add(direction === "next" ? "exit-left" : "exit-right");
    newSlide.classList.remove("enter-right", "enter-left");

    const cleanup = () => {
        if (currentSlide.parentNode) currentSlide.parentNode.removeChild(currentSlide);
        carouselAnimating = false;
    };
    newSlide.addEventListener("transitionend", cleanup, { once: true });
    setTimeout(cleanup, 600); // safety net in case transitionend doesn't fire
}

function carouselNext() {
    showSlideAtIndex(carouselIndex + 1, "next");
    restartAutoRotate();
}

function carouselPrev() {
    showSlideAtIndex(carouselIndex - 1, "prev");
    restartAutoRotate();
}

function startAutoRotate() {
    if (prefersReducedMotion()) return;
    stopAutoRotate();
    carouselTimer = setInterval(() => {
        showSlideAtIndex(carouselIndex + 1, "next");
    }, CAROUSEL_INTERVAL_MS);
}

function stopAutoRotate() {
    if (carouselTimer) {
        clearInterval(carouselTimer);
        carouselTimer = null;
    }
}

function restartAutoRotate() {
    startAutoRotate();
}

function refreshCarouselLiveData() {
    const { ordered, signature } = computeCarouselOrder();
    const currentFacilityId = carouselOrder[carouselIndex] ? carouselOrder[carouselIndex].id : null;

    if (signature !== carouselEmergencySignature) {
        // The set of active emergencies changed — recompute order (emergency
        // facilities float to the front) but try to keep showing whatever
        // the user is currently looking at, so the carousel doesn't jump.
        carouselEmergencySignature = signature;
        carouselOrder = ordered;
        const preservedIndex = currentFacilityId
            ? carouselOrder.findIndex(f => f.id === currentFacilityId)
            : -1;
        carouselIndex = preservedIndex >= 0 ? preservedIndex : 0;
        showSlideAtIndex(carouselIndex, null);
    } else {
        // No emergency-set change — just refresh the currently visible
        // slide's status text/classes in place (no slide animation).
        carouselOrder = ordered;
        const wrap = document.getElementById("carousel-track-wrap");
        const currentSlide = wrap && wrap.querySelector(".carousel-slide");
        const facility = carouselOrder[carouselIndex];
        if (currentSlide && facility) {
            const entry = classroomsState[facility.id];
            const isEmergency = !!(entry && entry.emergency);
            currentSlide.classList.toggle("is-emergency", isEmergency);
            currentSlide.innerHTML = buildFacilitySlideHTML(facility);
        }
    }
}

function initCampusWatchCarousel() {
    const { ordered, signature } = computeCarouselOrder();
    carouselOrder = ordered;
    carouselEmergencySignature = signature;
    carouselIndex = 0;

    if (carouselOrder.length > 0) {
        showSlideAtIndex(0, null);
    }

    const prevButton = document.getElementById("carousel-prev");
    const nextButton = document.getElementById("carousel-next");
    const carousel = document.getElementById("campus-watch-carousel");

    if (prevButton) prevButton.addEventListener("click", carouselPrev);
    if (nextButton) nextButton.addEventListener("click", carouselNext);

    if (carousel) {
        carousel.addEventListener("keydown", (event) => {
            if (event.key === "ArrowRight") { event.preventDefault(); carouselNext(); }
            if (event.key === "ArrowLeft") { event.preventDefault(); carouselPrev(); }
        });

        // Touch swipe support (mobile/tablet)
        let touchStartX = null;
        carousel.addEventListener("touchstart", (event) => {
            touchStartX = event.touches[0].clientX;
            stopAutoRotate();
        }, { passive: true });

        carousel.addEventListener("touchend", (event) => {
            if (touchStartX === null) return;
            const deltaX = event.changedTouches[0].clientX - touchStartX;
            const SWIPE_THRESHOLD = 40;
            if (deltaX > SWIPE_THRESHOLD) {
                carouselPrev();
            } else if (deltaX < -SWIPE_THRESHOLD) {
                carouselNext();
            } else {
                restartAutoRotate();
            }
            touchStartX = null;
        });

        // Pause auto-rotation while the user is hovering/interacting, resume after.
        carousel.addEventListener("mouseenter", stopAutoRotate);
        carousel.addEventListener("mouseleave", startAutoRotate);
    }

    startAutoRotate();
}