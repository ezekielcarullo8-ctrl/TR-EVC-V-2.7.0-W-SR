/* =========================================================================
    APP LOCK / OFFLINE DEVICE ACTIVATION
    -------------------------------------------------------------------------
    How this works:
    1. On first launch on a phone, the app reads a unique Device ID (from the
        Capacitor Device plugin when running as the built Android app).
    2. The buyer sends you that Device ID (text/chat/etc — no internet needed
        inside the app itself).
    3. You run the separate "keygen" tool (kept privately, NOT shipped inside
        this app) to turn that Device ID into an Activation Code.
    4. The buyer types the code in. It's checked using the exact same formula
        that generated it. If it matches, the app unlocks and remembers it.
    5. If someone copies the APK/app data to a different phone (e.g. via
        Share It / Quick Share), that phone has a DIFFERENT Device ID, so the
        old activation code will not work there. They'd need to contact you
        and pay for their own code.

    IMPORTANT: Change LICENSE_SALT below to your own private secret before
    you build/sell this app, and keep it out of anything you share publicly.
    The GitHub Actions workflow obfuscates this file during the build so the
    salt/algorithm isn't sitting around in plain, readable text inside the
    APK — but a determined person could still eventually extract it. This is
    a deterrent against casual sharing, not an unbreakable lock.
    ========================================================================= */

  const LICENSE_SALT = "CHANGE-THIS-TO-YOUR-OWN-SECRET-2026";
  const PIN_SALT = "CHANGE-THIS-PIN-SALT-TOO-2026";

  function simpleHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash * 33) ^ str.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16).toUpperCase().padStart(8, "0");
  }

  function generateActivationCode(deviceId) {
    return simpleHash(deviceId + LICENSE_SALT);
  }

  function hashPin(pin) {
    return simpleHash(pin + PIN_SALT);
  }

  function isAndroidApp() {
    return !!(window.Capacitor && window.Capacitor.getPlatform() === "android");
  }

  async function getDeviceId() {
    if (isAndroidApp() && window.Capacitor.Plugins.Device) {
      try {
        const info = await window.Capacitor.Plugins.Device.getId();
        return info.identifier;
      } catch (e) {
        console.error("Device ID error:", e);
      }
    }
    // Fallback used only when testing in a regular PC browser (not the built app)
    let fallback = localStorage.getItem("dev_fallback_device_id");
    if (!fallback) {
      fallback = "DEV-" + Math.random().toString(36).substring(2, 10).toUpperCase();
      localStorage.setItem("dev_fallback_device_id", fallback);
    }
    return fallback;
  }

  async function checkActivation() {
    const overlay = document.getElementById("activation-overlay");
    const androidApp = isAndroidApp();
    const deviceId = await getDeviceId();
    document.getElementById("device-id-display").innerText = deviceId;

    // Skip the lock while you're developing/testing in a regular browser.
    // The lock only activates inside the actual built Android app.
    if (!androidApp) {
      overlay.classList.add("hidden");
      checkPinLock();
      return;
    }

    const activatedFlag = localStorage.getItem("app_activated");
    const activatedDeviceId = localStorage.getItem("activated_device_id");

    if (activatedFlag === "true" && activatedDeviceId === deviceId) {
      overlay.classList.add("hidden");
      checkPinLock();
      return;
    }

    overlay.classList.remove("hidden");
    // checkPinLock() runs after a successful submitActivationCode() instead
  }

  function submitActivationCode() {
    const input = document.getElementById("activation-code-input").value.trim().toUpperCase();
    const deviceId = document.getElementById("device-id-display").innerText.trim();
    const errorEl = document.getElementById("activation-error");
    const expected = generateActivationCode(deviceId);

    if (!input) {
      errorEl.innerText = "Please enter the activation code.";
      return;
    }

    if (input === expected) {
      localStorage.setItem("app_activated", "true");
      localStorage.setItem("activated_device_id", deviceId);
      errorEl.innerText = "";
      document.getElementById("activation-overlay").classList.add("hidden");
      checkPinLock();
    } else {
      errorEl.innerText = "Invalid code for this device. Double-check with the seller.";
    }
  }

  /* =========================================================================
    PIN LOCK — a second, lighter-weight lock that guards the app every time
    it's opened (protects the treasurer's records from anyone who picks up
    the phone, separate from the one-time device activation above).
    ========================================================================= */

  async function checkPinLock() {
    if (!isAndroidApp()) return; // only enforced in the real built app

    const overlay = document.getElementById("pin-overlay");
    const storedHash = localStorage.getItem("treasurer_pin_hash");
    const titleEl = document.getElementById("pin-title");
    const subEl = document.getElementById("pin-subtext");

    if (!storedHash) {
      titleEl.innerText = "SET UP A PIN";
      subEl.innerText = "Create a 4-digit PIN to protect your records. You'll need it every time you open the app.";
      overlay.dataset.mode = "create";
    } else {
      titleEl.innerText = "ENTER PIN";
      subEl.innerText = "Enter your 4-digit PIN to continue.";
      overlay.dataset.mode = "verify";
    }
    overlay.classList.remove("hidden");
  }

  function submitPin() {
    const overlay = document.getElementById("pin-overlay");
    const inputEl = document.getElementById("pin-input");
    const input = inputEl.value.trim();
    const errorEl = document.getElementById("pin-error");

    if (!/^\d{4}$/.test(input)) {
      errorEl.innerText = "PIN must be exactly 4 digits.";
      return;
    }

    if (overlay.dataset.mode === "create") {
      localStorage.setItem("treasurer_pin_hash", hashPin(input));
      overlay.classList.add("hidden");
      inputEl.value = "";
      errorEl.innerText = "";
      return;
    }

    const storedHash = localStorage.getItem("treasurer_pin_hash");
    if (hashPin(input) === storedHash) {
      overlay.classList.add("hidden");
      inputEl.value = "";
      errorEl.innerText = "";
    } else {
      errorEl.innerText = "Incorrect PIN.";
      inputEl.value = "";
    }
  }

  function forgotPin() {
    const deviceId = document.getElementById("device-id-display").innerText.trim();
    const code = prompt("Forgot PIN — enter this device's Activation Code to reset it:");
    if (!code) return;
    const expected = generateActivationCode(deviceId);
    if (code.trim().toUpperCase() === expected) {
      localStorage.removeItem("treasurer_pin_hash");
      eveAlert("PIN reset. Please set a new PIN now.");
      checkPinLock();
    } else {
      eveAlert("That code doesn't match this device's activation code.", true);
    }
  }

  window.addEventListener("DOMContentLoaded", checkActivation);

  /* =========================================================================
    THEME + STYLE TOGGLES
    -------------------------------------------------------------------------
    Two independent preferences, each remembered in localStorage:
    - uiTheme: "light" | "dark"       → toggled by the moon/sun button
    - uiStyle: "default" | "cyberpunk" → toggled by the diamond/bolt button

    Cyberpunk mode overrides the palette to a fixed neon-on-dark look
    regardless of the light/dark choice, since the aesthetic depends on
    high-contrast glow effects.
    ========================================================================= */

  function applyThemeAndStyle() {
    const theme = localStorage.getItem("uiTheme") || "light";
    const style = localStorage.getItem("uiStyle") || "default";

    document.body.classList.toggle("theme-dark", theme === "dark");
    document.body.classList.toggle("style-cyberpunk", style === "cyberpunk");

    const themeBtn = document.getElementById("theme-toggle");
    const styleBtn = document.getElementById("style-toggle");
    if (themeBtn) {
      themeBtn.innerText = theme === "dark" ? "☀️" : "🌙";
      themeBtn.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    }
    if (styleBtn) {
      styleBtn.innerText = style === "cyberpunk" ? "⚡" : "◈";
      styleBtn.title = style === "cyberpunk" ? "Switch to default style" : "Switch to cyberpunk style";
    }
  }

function toggleTheme() {
  const current = localStorage.getItem("uiTheme") || "light";
  const next = current === "light" ? "dark" : "light";
  localStorage.setItem("uiTheme", next);
  applyThemeAndStyle();

  if (window.EveAssistant && typeof EveAssistant.showMsg === 'function') {
    const text = next === 'dark'
      ? "Did the lights turn off?"
      : "Oh look! The light came back!";
    const reaction = next === 'light' ? 'smile' : 'lookup';
    EveAssistant.showMsg(text, false, reaction);   // ← smile on light, lookup on dark
  }
}
  window.addEventListener("DOMContentLoaded", applyThemeAndStyle);

  /* =========================================================================
    SETTINGS DROPDOWN — houses Theme, Mode, Notepad, and Calculator toggles
    ========================================================================= */
  function toggleSettingsMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById("settings-menu");
    if (menu) menu.classList.toggle("hidden");
  }
  function closeSettingsMenu() {
    const menu = document.getElementById("settings-menu");
    if (menu) menu.classList.add("hidden");
  }
  document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("settings-dropdown");
    const menu = document.getElementById("settings-menu");
    if (!dropdown || !menu || menu.classList.contains("hidden")) return;
    if (!dropdown.contains(e.target)) closeSettingsMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSettingsMenu();
  });

  /* =========================================================================
    GENERIC AUTO-CLOSE FOR DROPDOWNS/ACCORDIONS — Transaction Logs, Generate
    Statement (and its nested sub-panels), and the floating Payment History
    popover. Tapping anywhere outside the open panel's scope closes it.
    ========================================================================= */
  document.addEventListener("click", (e) => {
    document.querySelectorAll(".auto-close-dropdown-content:not(.hidden)").forEach(panel => {
      const scope = panel.closest(".auto-close-dropdown-scope");
      if (scope && !scope.contains(e.target)) panel.classList.add("hidden");
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".auto-close-dropdown-content:not(.hidden)").forEach(panel => panel.classList.add("hidden"));
    }
  });

  /* =========================================================================
    PER-COLLECTION "FILTERS" DROPDOWN — status / method / date filters
    ========================================================================= */
  function toggleItemFiltersMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById("item-filters-menu");
    if (menu) menu.classList.toggle("hidden");
  }
  function closeItemFiltersMenu() {
    const menu = document.getElementById("item-filters-menu");
    if (menu) menu.classList.add("hidden");
  }
  document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("item-filters-dropdown");
    const menu = document.getElementById("item-filters-menu");
    if (!dropdown || !menu || menu.classList.contains("hidden")) return;
    if (!dropdown.contains(e.target)) closeItemFiltersMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeItemFiltersMenu();
  });

  /* =========================================================================
    MAIN APP
    ========================================================================= */


  /* =========================================================================
   MODE SYSTEM — Org Treasurer vs Class Treasurer
   ========================================================================= */
const MODE_KEY = "treasurerMode";

function getMode()  { return localStorage.getItem(MODE_KEY) || ""; }
function isOrg()    { return getMode() === "org"; }
function isClass()  { return getMode() === "class"; }

function setMode(mode) {
  localStorage.setItem(MODE_KEY, mode);
  location.reload();
}

function switchMode() {
  const modal = document.getElementById("mode-switch-confirm-modal");
  if (modal) {
    modal.classList.remove("hidden");
  } else {
    // Fallback in case the confirm modal markup is missing for some reason
    setMode(isOrg() ? "class" : "org");
  }
}

function closeSwitchModeConfirm() {
  const modal = document.getElementById("mode-switch-confirm-modal");
  if (modal) modal.classList.add("hidden");
}

function confirmSwitchMode() {
  closeSwitchModeConfirm();
  setMode(isOrg() ? "class" : "org");
}

function checkMode() {
  const overlay = document.getElementById("mode-overlay");
  const btn = document.getElementById("mode-toggle");
  if (!getMode()) {
    overlay.classList.remove("hidden");
    if (btn) btn.style.display = "none";
    return;
  }
  overlay.classList.add("hidden");
  if (btn) {
    btn.style.display = "flex";
    btn.innerText = isOrg() ? "ORG" : "CLASS";
  }
  applyMode();
}

/* Label helper: pass the org-mode text, get back the correct text */
function lbl(orgText) {
  if (isOrg()) return orgText;
  // Class-mode dictionary
  const map = {
    "Program Year Level": "Student",
    "Program Year Levels": "Students",
    "program year level": "student",
    "program year levels": "students",
    "Year Level": "Student",
    "Year Levels": "Students",
    "year level": "student",
    "year levels": "students",
    "Add Program & Year Level (Permanent)": "Add Student (Permanent)",
    "Search Year Level...": "Search Student...",
    "Search year level in this collection...": "Search student in this collection...",
    "Search or Select Year Level...": "Search or Select Students...",
    "Tap a program year level to view their balance across all collections": "Tap a student to view their balance across all collections",
    "Tap program year level to add a payment or edit": "Tap student to add a payment or edit",
    "Add All Year Level": "Add All Students",
    "Add Year Levels": "Add Students",
    "Select which year levels to enroll": "Select which students to enroll",
    "No year level added to this collection yet.": "No student added to this collection yet.",
    "No year levels in the database yet.": "No students in the database yet.",
    "No remaining year levels match your search.": "No remaining students match your search.",
    "Organization Info": "Class Info",
    "Organization Name": "Class/Section Name",
    "Treasurer Name": "Class Treasurer Name",
    "President / Adviser Name": "Adviser Name",
    "Save Organization Info": "Save Class Info",
    "Digital Ledger": "Class Ledger",
    "This copy of the app is not activated on this device yet.": "This copy of the app is not activated on this device yet.",
    "0 program year level in the database": "0 student in the database",
    "1 program year level in the database": "1 student in the database",
    "They will also be removed from all collections.": "They will also be removed from all collections.",
    "Payment from": "Payment from",
    "Cash Book": "Class Fund",
    "Projects & Events": "Class Activities"
  };
  return map[orgText] || orgText;
}

function applyMode() {
  // Nav label
const navStudents = document.querySelector('#nav-students');
if (navStudents) navStudents.innerHTML = `<span>🎓</span>${lbl("Year Level")}`;

// Modal title & description
const addAllTitle = document.querySelector('#add-all-modal h3');
if (addAllTitle) addAllTitle.innerText = lbl("Add Year Levels");
const addAllDesc = document.querySelector('#add-all-modal .note');
if (addAllDesc) addAllDesc.innerHTML = `Select which ${lbl("year levels").toLowerCase()} to enroll in <b id="add-all-cat-name">this collection</b>. Search to filter the list.`;

// Student input placeholder
// Student input placeholder
const newStudentInput = document.getElementById('new-student-name');
if (newStudentInput) newStudentInput.placeholder = isOrg() ? "e.g. BSIT 2, BSIT 3" : "e.g. Gon Freecs, Killua Zoldyck";

// Student count input is org-mode only (a "year level" has an enrolled
// headcount; individual class-mode students don't)
const countWrapper = document.getElementById('new-student-amount-wrapper');
if (countWrapper) countWrapper.classList.toggle('hidden', !isOrg());
  const orgRemittanceBox = document.getElementById('org-remittance-box');
  const classPaymentBox = document.getElementById('class-payment-box');
  const rosterOpenButton = document.getElementById('org-roster-open-button');
  if (orgRemittanceBox) orgRemittanceBox.classList.toggle('hidden', !isOrg());
  if (classPaymentBox) classPaymentBox.classList.toggle('hidden', isOrg());
  if (rosterOpenButton) rosterOpenButton.classList.toggle('hidden', !isOrg());
  if (isOrg()) populateAddRemittanceForm();
  document.querySelectorAll('.class-only-filter, .class-only-quick-pay').forEach(button => {
    button.classList.toggle('hidden-by-mode', !isClass());
  });
    // Nav visibility
  const cashbookNav = document.getElementById("nav-cashbook");
  const classfundNav = document.getElementById("nav-classfund");
  if (cashbookNav) cashbookNav.classList.toggle("hidden", isClass());
  if (classfundNav) classfundNav.classList.toggle("hidden", isOrg());
  
  // Static header relabeling
  const dbAdd = document.getElementById("db-add-header");
  if (dbAdd) dbAdd.innerText = lbl("Add Program & Year Level (Permanent)");

  const dbList = document.getElementById("db-list-header");
  if (dbList) dbList.innerText = isOrg() ? "Year Levels Database" : "Student Database"; // same text, but keeps pattern

  // Placeholders
  const sSearch = document.getElementById("search-students-db");
  if (sSearch) sSearch.placeholder = lbl("Search Year Level...");

  const iSearch = document.getElementById("item-search");
  if (iSearch) iSearch.placeholder = lbl("Search year level in this collection...");

  const stSearch = document.getElementById("student-search");
  if (stSearch) stSearch.placeholder = lbl("Search or Select Year Level...");

  // Add-tab tip
  const tip = document.querySelector(".add-tab-note");
  if (tip) {
    tip.innerHTML = `<b>💡 Tip:</b> ${lbl("Year Levels")} must be added permanently in the <b>${lbl("Year Level")}</b> tab before they appear in dropdowns. Payments recorded here automatically sync to your ${isOrg() ? 'Cash Book ledger' : 'class record'}.`;
  }

  // Mode-specific controls

  const recordsSearch = document.getElementById('item-search');
  if (recordsSearch) recordsSearch.classList.toggle('hidden', isOrg());
  const databaseSearch = document.getElementById('search-students-db');
  if (databaseSearch) databaseSearch.classList.toggle('hidden', isOrg());
  const addAllBtn = document.querySelector(".mode-add-all-btn");
  if (addAllBtn) addAllBtn.innerText = lbl("Add All Year Level");

  // Org-only sections in Summary: Organization/Class Info + Financial Statement
  // are both wrapped in their own container so they can be shown/hidden as a
  // whole block instead of fragile sibling-walking (which used to leave
  // stray dividers/labels behind).
  const orgInfoSection = document.getElementById("org-info-section");
  if (orgInfoSection) {
    orgInfoSection.classList.toggle("hidden", isClass());
    const orgHeader = orgInfoSection.querySelector("h3");
    if (orgHeader) orgHeader.innerText = lbl("Organization Info");
  }
  const finStmtSection = document.getElementById("financial-statement-section");
  if (finStmtSection) {
    finStmtSection.classList.toggle("hidden", isClass());
  }

  // Fix Add Student / Add Year Level button text
  const addStudentBtn = document.querySelector('#database-section button[onclick="addStudent()"]');
  if (addStudentBtn) addStudentBtn.innerText = isOrg() ? "Add Year Level(s)" : "Add Student(s)";

  // Input placeholders in Summary / Org Info
  const orgName = document.getElementById("org-name");
  if (orgName) orgName.placeholder = lbl("Organization Name") + " (e.g. ITO - PUP UNISAN)";
  const orgTreas = document.getElementById("org-treasurer");
  if (orgTreas) orgTreas.placeholder = lbl("Treasurer Name");
  const orgPres = document.getElementById("org-president");
  if (orgPres) orgPres.placeholder = lbl("President / Adviser Name");

  // Re-render dynamic views so labels update
  renderStudents();
  renderCategories();
  renderSummary();
}

  const STORAGE_KEY = "treasurerRecorderEzekiel";
  let db = JSON.parse(localStorage.getItem(STORAGE_KEY)) || { students: [], categories: {} };

  // Bring any old or new-format backup up to the current data shape.
  // Safe to call repeatedly (on load and after importing a backup).
    function migrateDb() {
    let migrationChanged = false;
    db.students = (db.students || []).map(s => {
      const entry = typeof s === "string" ? { name: s } : { ...s, name: s.name || "Unknown" };
      entry.id = entry.id || Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      entry.perStudentAmount = Number.isFinite(Number(entry.perStudentAmount)) ? Math.max(0, Number(entry.perStudentAmount)) : 0;
      if (isOrg()) {
        entry.students = Array.isArray(entry.students) ? entry.students.map(student => ({
          id: student.id || Date.now() + "-" + Math.random().toString(36).slice(2, 8),
          name: student.name || "Unnamed Student",
          profile: student.profile || "",
          paymentStatus: student.paymentStatus === "paid" ? "paid" : "unpaid"
        })) : [];
      }
      return entry;
    });
    db.categories = db.categories || {};
    if (isOrg()) {
      Object.values(db.categories).forEach(category => {
        (category.records || []).forEach(record => {
          const yearLevel = db.students.find(student => student.name === record.name);
          if (yearLevel && getYearLevelStudentCount(yearLevel) > 0 && Number(yearLevel.perStudentAmount) > 0) {
            const due = round2(getYearLevelStudentCount(yearLevel) * Number(yearLevel.perStudentAmount));
            if (record.due !== due || record.yearLevelId !== yearLevel.id) migrationChanged = true;
            record.due = due;
            record.yearLevelId = yearLevel.id;
          }
        });
      });
    }

    // Inside your migrateDb() function, ensure transfers and cashbook have fallback parameters:
    db.cashbook = db.cashbook || { openingBalance: 0, transactions: [] };
    db.cashbook.openingBalance = db.cashbook.openingBalance || 0;
    db.cashbook.transactions = db.cashbook.transactions || [];
    db.transfers = db.transfers || []; // Stores inter-collection tracking movements


    db.projects = db.projects || [];
    db.orgSettings = db.orgSettings || { orgName: "", treasurerName: "", presidentName: "", schoolYear: "" };

        db.classFund = db.classFund || { weeklyDue: 20, startDate: new Date().toISOString().slice(0, 10), records: {}, transactions: [] };
    db.classFund.weeklyDue = db.classFund.weeklyDue || 20;
    db.classFund.startDate = db.classFund.startDate || new Date().toISOString().slice(0, 10);
    db.classFund.records = db.classFund.records || {};
    db.classFund.transactions = db.classFund.transactions || [];
    db.transfers = db.transfers || [];
    db.notepad = db.notepad || { notes: [] };
// Migrate old folder-based notepad to flat notes
if (db.notepad.folders && Array.isArray(db.notepad.folders)) {
  db.notepad.notes = [];
  db.notepad.folders.forEach(f => {
    if (f.notes && Array.isArray(f.notes)) {
      f.notes.forEach(n => {
        db.notepad.notes.push({
          id: n.id || Date.now() + "-" + Math.random().toString(36).slice(2, 7),
          title: (n.title && n.title !== 'Untitled') ? n.title : (f.name || 'Note'),
          content: n.content || '',
          updated: n.updated || new Date().toISOString().slice(0, 10)
        });
      });
    }
  });
  delete db.notepad.folders;
}
db.notepad.notes = db.notepad.notes || [];
    if (migrationChanged) localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

    function recordClassFundExpense() {
    const date = document.getElementById("cf-expense-date").value || new Date().toISOString().slice(0, 10);
    const desc = document.getElementById("cf-expense-desc").value.trim();
    const amount = round2(parseFloat(document.getElementById("cf-expense-amount").value) || 0);
    const note = document.getElementById("cf-expense-note").value.trim();

    if (!desc) return eveAlert("Please enter what the expense was for.", true);
    if (amount <= 0) return eveAlert("Please enter a valid amount.", true);

    db.classFund.transactions.push({
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      type: "expense",
      date,
      description: desc,
      amount,
      note
    });

    saveData();
    renderClassFund();
    eveAlert(`Expense of ${peso(amount)} recorded.`);
  }

  function deleteClassFundTxn(id) {
    if (!confirm("Delete this expense?")) return;
    db.classFund.transactions = db.classFund.transactions.filter(t => String(t.id) !== String(id));
    saveData();
    renderClassFund();
  }

  migrateDb();

  let currentCategory = "";
  let editingIndex = null;
  let paidFilter = "all";
  let collectionEditMethod = "cash";
  let addYearFilter = "all";
  let quickPayYearFilter = "all";
let addAllSelected = new Set();
  let quickPaySelected = new Set();
  let undoStack = [];
  let redoStack = [];
  const MAX_UNDO_HISTORY = 50;
  let editingHistory = { recIdx: null, histIdx: null };
  let cfExpandedNames = new Set();

/* =========================================================================
   PIECE 1: UNIFIED SINGLE-OPEN DRAWER CONTEXT TOGGLE SWITCH
   ========================================================================= */
function toggleClassFundDetail(safeId) {
  const name = decodeURIComponent(safeId);
  
  if (cfExpandedNames.has(name)) {
    // If tapping the already open card, close it
    cfExpandedNames.delete(name);
  } else {
    // Force complete closure of all other cards by wiping the global tracker clean
    cfExpandedNames.clear();
    // Register only the newly selected profile name context
    cfExpandedNames.add(name);
  }

  // Instantly push layout updates across your background views and overlay boxes
  if (typeof renderClassFund === "function") renderClassFund();
  if (typeof syncCfStudentsOverlay === "function") syncCfStudentsOverlay();
}

  let cfLedgerEditing = { type: null, student: null, histIdx: null, id: null };

  // ---------- HELPERS ----------

  /**
   * Escape a string for safe insertion into HTML text content and attributes.
   * Handles &, <, >, ", and ' to prevent XSS and broken markup.
   */
  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

function saveData() {
  const prevRaw = localStorage.getItem(STORAGE_KEY);
  if (prevRaw !== null) {
    undoStack.push({ state: prevRaw, time: Date.now() });
    if (undoStack.length > MAX_UNDO_HISTORY) undoStack.shift();
  }
  redoStack = [];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  updateUndoRedoButtons();
  
  // FIXED: Forces EVE's panel widgets to synchronize dynamically whenever saveData is called
  if (typeof renderEveSummary === "function") {
    const summaryTabSection = document.getElementById('eve-summary-tab-section');
    if (summaryTabSection && !summaryTabSection.classList.contains('hidden')) {
      renderEveSummary();
    }
  }
  
  const logsView = document.getElementById('eve-logs-view');
  if (logsView && !logsView.classList.contains('hidden') && typeof renderEveLogs === "function") {
    renderEveLogs();
  }
}

// NEW helper — keeps the EVE Data / Logs panels live instead of stale
function refreshEveSummaryIfVisible() {
  const summaryTabSection = document.getElementById('eve-summary-tab-section');
  if (summaryTabSection && !summaryTabSection.classList.contains('hidden')) {
    renderEveSummary();
  }
  const logsView = document.getElementById('eve-logs-view');
  if (logsView && !logsView.classList.contains('hidden')) {
    renderEveLogs();
  }
}
  function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;

    const undoBtnLogs = document.getElementById('undo-btn-logs');
    const redoBtnLogs = document.getElementById('redo-btn-logs');
    if (undoBtnLogs) undoBtnLogs.disabled = undoStack.length === 0;
    if (redoBtnLogs) redoBtnLogs.disabled = redoStack.length === 0;

    const undoCount = document.getElementById('undo-count-logs');
    const redoCount = document.getElementById('redo-count-logs');
    if (undoCount) undoCount.innerText = undoStack.length;
    if (redoCount) redoCount.innerText = redoStack.length;
  }

  function performUndo() {
    if (undoStack.length === 0) return eveAlert("Nothing to undo.", true);
    const entry = undoStack.pop();
    const currentRaw = localStorage.getItem(STORAGE_KEY);
    redoStack.push({ state: currentRaw, time: Date.now() });
    if (redoStack.length > MAX_UNDO_HISTORY) redoStack.shift();

    db = JSON.parse(entry.state);
    migrateDb();
    localStorage.setItem(STORAGE_KEY, entry.state);
    refreshAllViews();
    eveAlert("Undone.");
  }

  function performRedo() {
    if (redoStack.length === 0) return eveAlert("Nothing to redo.", true);
    const entry = redoStack.pop();
    const currentRaw = localStorage.getItem(STORAGE_KEY);
    undoStack.push({ state: currentRaw, time: Date.now() });
    if (undoStack.length > MAX_UNDO_HISTORY) undoStack.shift();

    db = JSON.parse(entry.state);
    migrateDb();
    localStorage.setItem(STORAGE_KEY, entry.state);
    refreshAllViews();
    eveAlert("Redone.");
  }

  // Re-renders every view after an Undo/Redo, since the whole database
  // may have jumped to a very different state than what's on screen.
  function refreshAllViews() {
    editingIndex = null;
    editingHistory = { recIdx: null, histIdx: null };
    addAllSelected.clear();
    quickPaySelected.clear();

    renderStudents();
    renderCategories();
    renderSummary();

    if (isOrg()) {
      renderCashbookSummary();
      renderCashbookList();
      renderProjects();
    }
    if (isClass()) {
      renderClassFund();
    }

    loadOrgSettingsForm();
    updateAppHeader();

    const itemView = document.getElementById('item-view');
    if (itemView && !itemView.classList.contains('hidden')) {
      if (currentCategory && db.categories[currentCategory]) {
        renderItemList();
      } else {
        backToCategories();
      }
    }

    const profileView = document.getElementById('student-profile-view');
    if (profileView && !profileView.classList.contains('hidden')) {
      const nameEl = document.getElementById('profile-student-name');
      const name = nameEl ? nameEl.innerText : '';
      if (name && db.students.some(s => s.name === name)) {
        renderStudentProfile(name);
      } else {
        backToStudentList();
      }
    }

    const logsView = document.getElementById('eve-logs-view');
    if (logsView && !logsView.classList.contains('hidden')) renderEveLogs();

    const summaryTabSection = document.getElementById('eve-summary-tab-section');
    if (summaryTabSection && !summaryTabSection.classList.contains('hidden')) renderEveSummary();

    updateUndoRedoButtons();
  }

  function peso(n) {
    return `₱${(n || 0).toFixed(2)}`;
  }

  // Rounds to 2 decimal places to avoid floating-point drift from repeated
  // addition (e.g. 0.1 + 0.2 style errors) building up over many payments.
  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // Finds an existing category name case-insensitively (so "Field Trip" and
  // "field trip" are treated as the same collection instead of duplicates).
  function findCategoryKeyCI(name) {
    const lower = name.toLowerCase();
    return Object.keys(db.categories).find(k => k.toLowerCase() === lower) || null;
  }

  function yearLevelBucket(value) {
    const text = String(value || "").toLowerCase();
    const match = text.match(/(?:^|\s)([1-4])(?:st|nd|rd|th)?(?:\s*year)?(?:\s|$)/);
    return match ? match[1] : "";
  }

  function getOrgRosterEntries() {
    if (!isOrg()) return db.students.map(s => ({ name: s.name, yearLevel: "", yearLevelId: s.id }));
    const entries = [];
    db.students.forEach(yearLevel => {
      const roster = Array.isArray(yearLevel.students) ? yearLevel.students : [];
      if (roster.length) {
        roster.forEach(student => entries.push({
          name: student.name,
          yearLevel: yearLevel.name,
          yearLevelId: yearLevel.id,
          studentId: student.id,
          profile: student.profile || ""
        }));
      } else {
        entries.push({ name: yearLevel.name, yearLevel: yearLevel.name, yearLevelId: yearLevel.id, legacyYearLevel: true });
      }
    });
    return entries;
  }

  function getYearLevelStudentCount(yearLevel) {
    return isOrg() && yearLevel && Array.isArray(yearLevel.students) ? yearLevel.students.length : 0;
  }

  function getYearLevelTotalDue(yearLevel, fallbackAmount = 0) {
    const count = getYearLevelStudentCount(yearLevel);
    const perStudent = Number(yearLevel?.perStudentAmount) || Number(fallbackAmount) || 0;
    return count > 0 && perStudent > 0 ? round2(count * perStudent) : round2(fallbackAmount);
  }


function switchTab(id, btn) {
  if (id === 'cashbook-section' && isClass()) return;
  if (id === 'classfund-section' && isOrg()) return;

  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  
  const targetPage = document.getElementById(id);
  if (targetPage) targetPage.classList.remove('hidden');
  
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  // ── ROUTING MATRIX EXECUTION CODES ──
  if (id === 'inventory-section') {
    backToCategories();
  } else if (id === 'database-section') {
    backToStudentList();
    renderStudents();
  } else if (id === 'cashbook-section') {
    document.getElementById('project-detail-view').classList.add('hidden');
    document.getElementById('projects-view').classList.add('hidden');
    document.getElementById('cashbook-main-view').classList.remove('hidden');
    renderCashbookSummary();
    renderCashbookList();
    renderProjects();
  } else if (id === 'classfund-section') {
    renderClassFund();
  } else if (id === 'summary-section') {
    loadOrgSettingsForm();
    renderSummary();
  } else if (id === 'eve-summary-tab-section') {
    renderEveSummary();
  }
}



  

  // ================= STUDENTS (PERMANENT DATABASE) =================

function addStudent() {
  const input = document.getElementById("new-student-name");
  const amountInput = document.getElementById("new-student-amount");
  const rawValue = input.value.trim();
  const label = lbl("year level").toLowerCase();
  if (!rawValue) return eveAlert("Please enter a " + label + " name", true);

  // Support comma-separated bulk entry: "Name One, Name Two, Name Three"
  const names = rawValue
    .split(",")
    .map(n => n.trim())
    .filter(n => n.length > 0);

  if (names.length === 0) return eveAlert("Please enter a " + label + " name", true);

  const perStudentAmount = isOrg() ? Math.max(0, round2(parseFloat(amountInput?.value) || 0)) : 0;

  const added = [];
  const duplicates = [];
  const seenThisBatch = new Set();

  names.forEach(name => {
    const key = name.toLowerCase();
    if (db.students.some(s => s.name.toLowerCase() === key) || seenThisBatch.has(key)) {
      duplicates.push(name);
      return;
    }
    seenThisBatch.add(key);
    db.students.push({
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      name,
      students: isOrg() ? [] : undefined,
      perStudentAmount
    });
    added.push(name);
  });

  if (added.length > 0) {
    saveData();
    renderStudents();
  }

  input.value = "";
  if (amountInput) amountInput.value = "";

  const labelPlural = added.length === 1 ? label : lbl("year levels").toLowerCase();
  if (added.length > 0 && duplicates.length === 0) {
    if (added.length > 1) eveAlert(`Added ${added.length} ${labelPlural}: ${added.join(", ")}`);
  } else if (added.length > 0 && duplicates.length > 0) {
    eveAlert(`Added ${added.length} ${labelPlural}. Skipped duplicate(s): ${duplicates.join(", ")}`, true);
  } else if (added.length === 0 && duplicates.length > 0) {
    eveAlert(`All entered ${labelPlural} are already in the database: ${duplicates.join(", ")}`, true);
  }
}

  /* =========================================================================
    CLASS FUND — Independent Weekly Tracker (Class Mode)
    ========================================================================= */

  function getExpectedWeeks(startDateStr) {
    if (!startDateStr) return 0;
    const start = new Date(startDateStr + "T00:00:00");
    const now = new Date();
    start.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    if (now < start) return 0;
    const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7) + 1;
  }

  function getClassFundExpected(studentName) {
    const cf = db.classFund;
    if (!cf.weeklyDue || !cf.startDate) return 0;
    return round2(getExpectedWeeks(cf.startDate) * cf.weeklyDue);
  }

  function getMissedWeeks(studentName) {
    const cf = db.classFund;
    if (!cf.weeklyDue || cf.weeklyDue <= 0) return 0;
    const expected = getClassFundExpected(studentName);
    const paid = cf.records[studentName] ? cf.records[studentName].paid : 0;
    if (paid >= expected) return 0;
    return Math.ceil((expected - paid) / cf.weeklyDue);
  }

  function getLastPaymentDate(studentName) {
    const rec = db.classFund.records[studentName];
    if (!rec || !rec.history || rec.history.length === 0) return null;
    return rec.history[rec.history.length - 1].date;
  }



  function saveClassFundSettings() {
    const weekly = round2(parseFloat(document.getElementById("cf-weekly-due").value) || 0);
    const startDate = document.getElementById("cf-start-date").value;
    if (weekly <= 0) return eveAlert("Please enter a valid weekly amount.", true);
    if (!startDate) return eveAlert("Please select a collection start date.", true);
    db.classFund.weeklyDue = weekly;
    db.classFund.startDate = startDate;
    saveData();
    renderClassFund();
    eveAlert("Class Fund settings saved.");
  }

/* =========================================================================
   PIECE 2: INTERACTIVE BATCH ENROLLMENT AND VIEW REFRESH ENGINE
   ========================================================================= */
function addAllToClassFund() {
  const cf = db.classFund;
  let added = 0;
  let skipped = 0;

  // Verify master database records array states
  if (!db.students || db.students.length === 0) {
    return eveAlert("No students found in the database. Go to the Students tab to add them first.", true);
  }

  db.students.forEach(s => {
    if (!cf.records[s.name]) {
      // Allocate fresh profile block trace metrics
      cf.records[s.name] = { 
        paid: 0, 
        history: [] 
      };
      added++;
    } else {
      skipped++;
    }
  });

  if (added === 0) {
    eveAlert("All existing database students are already enrolled inside tracking frames.");
    return;
  }

  saveData();

  // SYSTEM FORCE REFRESH: Instantly update active foreground panels and modal lists
  if (typeof renderClassFund === "function") renderClassFund();
  if (typeof syncCfStudentsOverlay === "function") syncCfStudentsOverlay();
  if (typeof syncCfLedgerOverlay === "function") syncCfLedgerOverlay();
  if (typeof renderEveSummary === "function") renderEveSummary();

  eveAlert(`Enrolled ${added} student(s) into Class Fund tracking variables cleanly.`);
}


    function resetClassFundData() {
    if (!confirm("Reset all Class Fund records? This clears every payment, expense, and student enrollment.")) return;
    db.classFund.records = {};
    db.classFund.transactions = [];
    saveData();
    renderClassFund();
  }

// Global memory state initialization
window.__classFundPaymentStudent = "";

function openClassFundPaymentModal(studentRef) {
  // Graceful multi-format lookups avoiding decoding errors
  let studentName = studentRef;
  try {
    if (studentRef.includes('%')) {
      studentName = decodeURIComponent(studentRef);
    }
  } catch(e) {
    studentName = studentRef;
  }
  
  if (!studentName) return eveAlert("Target student parameter missing.", true);
  
  window.__classFundPaymentStudent = studentName;
  
  const modal = document.getElementById("cf-payment-modal");
  if (!modal) {
    // Elegant fall-through engine prompt fallback option
    const rawAmount = prompt(`Record Class Fund Payment for: ${studentName}\nEnter Amount (₱):`);
    if (rawAmount === null) return;
    const amount = round2(parseFloat(rawAmount) || 0);
    if (amount <= 0) return eveAlert("Invalid operational tracking amount entered.", true);
    executeClassFundPaymentDirect(studentName, amount, new Date().toISOString().slice(0, 10), "Direct Entry Ledger");
    return;
  }
  
  document.getElementById("cf-payment-student").textContent = studentName;
  document.getElementById("cf-payment-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("cf-payment-amount").value = "";
  document.getElementById("cf-payment-note").value = "";
  
  modal.classList.remove("hidden");
}

function submitClassFundPaymentForm() {
  const studentName = window.__classFundPaymentStudent;
  const amount = round2(parseFloat(document.getElementById("cf-payment-amount").value) || 0);
  const date = document.getElementById("cf-payment-date").value || new Date().toISOString().slice(0, 10);
  const note = document.getElementById("cf-payment-note").value.trim();
  
  if (!studentName) return eveAlert("Context profile processing state corrupted.", true);
  if (amount <= 0) return eveAlert("Provide a valid numeric processing tracking amount.", true);
  
  executeClassFundPaymentDirect(studentName, amount, date, note);
  document.getElementById("cf-payment-modal").classList.add("hidden");
}

function executeClassFundPaymentDirect(studentName, amount, date, note) {
  if (!db.classFund.records[studentName]) {
    db.classFund.records[studentName] = { paid: 0, history: [] };
  }
  
  const recordId = "CF-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  const rec = db.classFund.records[studentName];
  
  rec.history.push({
    id: recordId,
    amount: amount,
    date: date,
    note: note || "Class Fund Payment"
  });
  
  rec.paid = round2(rec.history.reduce((sum, h) => sum + (Number(h.amount) || 0), 0));
  
  // Link automatically down stream into internal transaction log arrays
  if (!db.classFund.transactions) db.classFund.transactions = [];
  db.classFund.transactions.push({
    id: recordId,
    type: "income",
    date: date,
    description: `Class Fund Payment from ${studentName}`,
    amount: amount,
    note: note
  });
  
  saveData();
  renderClassFund();
  eveAlert(`Payment of ${peso(amount)} documented cleanly for ${studentName}.`);
}




function deleteClassFundPayment(studentName, idx) {

  const rec =
    db.classFund.records[studentName];

  if (
    !rec ||
    !Array.isArray(rec.history) ||
    !rec.history[idx]
  ) {
    return;
  }

  if (
    !confirm(
      "Delete this Class Fund payment?"
    )
  ) {
    return;
  }

  const removed =
    rec.history.splice(idx, 1)[0];

  // Recalculate total
  rec.paid = round2(
    rec.history.reduce(
      (sum, entry) =>
        sum + (Number(entry.amount) || 0),
      0
    )
  );

  // Remove linked Cash Book transaction
  if (
    removed?.id &&
    Array.isArray(
      db.cashbook.transactions
    )
  ) {

    db.cashbook.transactions =
      db.cashbook.transactions.filter(
        t =>
          String(
            t.classFundPaymentId
          ) !== String(removed.id)
      );
  }

  saveData();

  renderClassFund();

  renderCashbookSummary();
  renderCashbookList();

  if (typeof renderCashbookLog === "function") {
    renderCashbookLog();
  }

  if (typeof renderProjects === "function") {
    renderProjects();
  }

  eveAlert("Payment deleted.");
}

  function deleteClassFundStudent(name) {
    if (!confirm(`Remove ${name} from Class Fund tracking? Their history will be deleted.`)) return;
    delete db.classFund.records[name];
    saveData();
    renderClassFund();
  }



  /* -------------------------------------------------------------------------
    CLASS FUND LEDGER — FULL SCREEN TRANSACTION EDITOR
    -------------------------------------------------------------------------
    Every row in the Class Fund Ledger (both student payments/income and
    manual expenses) opens this full-screen panel so it can be edited or
    deleted in one place, instead of only being editable from inside an
    individual student's expanded card.
    ------------------------------------------------------------------------- */

// ── HIGH-PERFORMANCE LOW-LATENCY CLASS FUND EDITOR ENGINE ──
const ClassFundEditor = {
  activeTxnId: null,
  activeStudent: null,
  activeType: null,

  getModalOverlay() {
    return (
      document.getElementById("cf-transaction-modal-overlay") || 
      document.getElementById("cf-ledger-edit-modal") ||
      document.getElementById("cf-ledger-edit-overlay") || 
      document.getElementById("cf-edit-modal-overlay") ||
      document.querySelector("[id*='cf-edit']") ||
      document.querySelector("[id*='transaction-modal']")
    );
  },

  open(type, param1, param2) {
    const overlay = this.getModalOverlay();
    if (!overlay) return;

    // Apply high-performance rendering properties directly via code styling engines
    overlay.style.setProperty("will-change", "opacity, transform");
    overlay.style.setProperty("transition", "opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1)");

    this.activeType = type === 'income' ? 'income' : 'expense';

    if (this.activeType === 'income') {
      this.activeStudent = param1;
      const histIdx = parseInt(param2, 10);
      const studentRecord = db.classFund?.records?.[this.activeStudent];
      const historyItem = studentRecord?.history?.[histIdx] || {};

      if (!historyItem.id) {
        historyItem.id = "INC-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
      }
      this.activeTxnId = historyItem.id;

      this.setFieldValue("edit-cf-amount", historyItem.amount || "");
      this.setFieldValue("edit-cf-date", historyItem.date || "");
      this.setFieldValue("edit-cf-note", historyItem.note || "Class Fund");
    } else {
      this.activeTxnId = param1;
      this.activeStudent = null;
      const expenseItem = (db.classFund?.transactions || []).find(t => String(t.id) === String(this.activeTxnId)) || {};

      this.setFieldValue("edit-cf-amount", expenseItem.amount || "");
      this.setFieldValue("edit-cf-date", expenseItem.date || "");
      this.setFieldValue("edit-cf-note", expenseItem.description || "");
    }

    // INTERCEPT BOTH TOUCH AND CLICK EVENTS TO ELIMINATE 300ms DELAYS
    const saveBtn = overlay.querySelector(".btn-save, input[type='submit'], [onclick*='save'], button:not(.mini-delete):not(.mini-btn)");
    if (saveBtn) {
      saveBtn.removeAttribute("onclick");
      this.bindFastClick(saveBtn, () => this.save());
    }

    const deleteBtn = overlay.querySelector(".btn-delete, .mini-delete, [onclick*='delete'], button[style*='#b3423b']");
    if (deleteBtn) {
      deleteBtn.removeAttribute("onclick");
      this.bindFastClick(deleteBtn, () => this.delete());
    }

    // Reveal container frames hardware-accelerated smoothly
    overlay.classList.remove("hidden");
    overlay.style.display = "block";
    overlay.style.opacity = "1";
  },

  /**
   * Bypasses webview delays by converting touch inputs into immediate callback signals
   */
  bindFastClick(element, callback) {
    let moved = false;
    
    // Clear legacy configurations to stop stacking listeners
    const clone = element.cloneNode(true);
    element.parentNode.replaceChild(clone, element);
    
    clone.addEventListener("touchstart", () => { moved = false; }, { passive: true });
    clone.addEventListener("touchmove", () => { moved = true; }, { passive: true });
    clone.addEventListener("touchend", (e) => {
      if (!moved) {
        e.preventDefault();
        callback();
      }
    });
    // Fallback support framework layer for standard desk setups
    clone.addEventListener("click", (e) => {
      e.preventDefault();
      callback();
    });
  },

  save() {
    const amtValue = parseFloat(this.getFieldValue("edit-cf-amount") || "0");
    const dateValue = this.getFieldValue("edit-cf-date") || "";
    const noteValue = this.getFieldValue("edit-cf-note") || "";

    const cleanAmount = round2(amtValue);
    if (cleanAmount <= 0 || !dateValue) {
      alert("Please check fields. Enter a valid selection date and a calculation amount statement.");
      return;
    }

    if (this.activeType === "income") {
      Object.keys(db.classFund?.records || {}).forEach(name => {
        const studentProfile = db.classFund.records[name];
        (studentProfile.history || []).forEach(h => {
          if (this.activeTxnId && String(h.id) === String(this.activeTxnId)) {
            h.amount = cleanAmount;
            h.date = dateValue;
            h.note = noteValue;
          }
        });
        studentProfile.paid = round2((studentProfile.history || []).reduce((s, h) => s + (Number(h.amount) || 0), 0));
      });

      if (db.cashbook?.transactions && Array.isArray(db.cashbook.transactions)) {
        let cbRow = db.cashbook.transactions.find(t => this.activeTxnId && String(t.id) === String(this.activeTxnId));
        if (!cbRow && this.activeStudent) {
          cbRow = db.cashbook.transactions.find(t => t.date === dateValue && String(t.description).includes(this.activeStudent));
        }
        if (cbRow) {
          cbRow.amount = cleanAmount;
          cbRow.date = dateValue;
          cbRow.description = `Payment from ${this.activeStudent || "Student"}${noteValue ? ' • ' + noteValue : ''}`;
        }
      }
    } else {
      if (db.classFund?.transactions) {
        const exp = db.classFund.transactions.find(t => String(t.id) === String(this.activeTxnId));
        if (exp) { exp.amount = cleanAmount; exp.date = dateValue; exp.description = noteValue; }
      }
      if (db.cashbook?.transactions) {
        const cbExp = db.cashbook.transactions.find(t => String(t.id) === String(this.activeTxnId));
        if (cbExp) { cbExp.amount = cleanAmount; cbExp.date = dateValue; cbExp.description = noteValue; }
      }
    }

    saveData();
    this.refreshAndClose();
  },

  delete() {
    if (!confirm("Permanently delete this transaction log entry record? Changes materialize instantly.")) return;

    if (this.activeType === "income") {
      Object.keys(db.classFund?.records || {}).forEach(name => {
        const studentProfile = db.classFund.records[name];
        if (studentProfile.history && this.activeTxnId) {
          studentProfile.history = studentProfile.history.filter(h => String(h.id) !== String(this.activeTxnId));
        }
        studentProfile.paid = round2((studentProfile.history || []).reduce((s, h) => s + (Number(h.amount) || 0), 0));
      });

      if (db.cashbook?.transactions) {
        db.cashbook.transactions = db.cashbook.transactions.filter(t => {
          if (this.activeTxnId && String(t.id) === String(this.activeTxnId)) return false;
          if (this.activeStudent && String(t.description).includes(this.activeStudent)) {
            return round2(t.amount) !== round2(parseFloat(this.getFieldValue("edit-cf-amount") || "0"));
          }
          return true;
        });
      }
    } else {
      if (db.classFund?.transactions) {
        db.classFund.transactions = db.classFund.transactions.filter(t => String(t.id) !== String(this.activeTxnId));
      }
      if (db.cashbook?.transactions) {
        db.cashbook.transactions = db.cashbook.transactions.filter(t => String(t.id) !== String(this.activeTxnId));
      }
    }

    saveData();
    this.refreshAndClose();
  },

  refreshAndClose() {
    // Wrap system UI updates in a quick execution frame to keep the interface smooth
    requestAnimationFrame(() => {
      if (typeof renderClassFund === "function") renderClassFund();
      if (typeof renderCashbookSummary === "function") renderCashbookSummary();
      if (typeof renderCashbookList === "function") renderCashbookList();
      if (typeof renderSummary === "function") renderSummary();
      if (typeof renderEveSummary === "function") renderEveSummary();
      if (typeof syncCfLedgerOverlay === "function") syncCfLedgerOverlay();
      if (typeof syncCfStudentsOverlay === "function") syncCfStudentsOverlay();

      const overlay = this.getModalOverlay();
      if (overlay) {
        overlay.style.opacity = "0";
        setTimeout(() => {
          overlay.classList.add("hidden");
          overlay.style.display = "none";
        }, 150);
      }

      if (typeof eveAlert === "function") eveAlert("Synchronized live cleanly.");
      
      this.activeTxnId = null;
      this.activeStudent = null;
      this.activeType = null;
    });
  },

  getFieldValue(id) { const el = document.getElementById(id); return el ? el.value.trim() : ""; },
  setFieldValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
};

/* ── REPLACES the entire ClassFundEditor object + wrapper ── */

function openCfLedgerEdit(type, a, b) {
  const modal = document.getElementById('cf-ledger-edit-modal');
  if (!modal) return;
  const typeLabel  = document.getElementById('cf-ledger-edit-type');
  const descLabel  = document.getElementById('cf-ledger-edit-desc-label');
  const descInput  = document.getElementById('cf-ledger-edit-desc');
  const dateInput  = document.getElementById('cf-ledger-edit-date');
  const amountInput= document.getElementById('cf-ledger-edit-amount');
  const noteInput  = document.getElementById('cf-ledger-edit-note');

  if (type === 'income') {
    const name = a, histIdx = b;
    const rec = db.classFund.records[name];
    if (!rec || !rec.history[histIdx]) return eveAlert("Couldn't find that payment entry.", true);
    const entry = rec.history[histIdx];

    cfLedgerEditing = { type: 'income', student: name, histIdx, id: entry.id || null };
    if (typeLabel) { typeLabel.innerText = "Income • Student Payment"; typeLabel.style.color = "var(--success)"; }
    if (descLabel) descLabel.innerText = "Student";
    if (descInput) { descInput.value = name; descInput.disabled = true; }
    if (dateInput) dateInput.value = entry.date || "";
    if (amountInput) amountInput.value = entry.amount;
    if (noteInput) noteInput.value = entry.note || "";
  } else {
    const id = a;
    const txn = (db.classFund.transactions || []).find(t => String(t.id) === String(id));
    if (!txn) return eveAlert("Couldn't find that expense entry.", true);

    cfLedgerEditing = { type: 'expense', student: null, histIdx: null, id };
    if (typeLabel) { typeLabel.innerText = "Expense"; typeLabel.style.color = "var(--danger)"; }
    if (descLabel) descLabel.innerText = "Description";
    if (descInput) { descInput.value = txn.description || ""; descInput.disabled = false; }
    if (dateInput) dateInput.value = txn.date || "";
    if (amountInput) amountInput.value = txn.amount;
    if (noteInput) noteInput.value = txn.note || "";
  }

  modal.classList.remove('hidden');
}

function closeCfLedgerEdit() {
  const modal = document.getElementById('cf-ledger-edit-modal');
  if (modal) modal.classList.add('hidden');
  cfLedgerEditing = { type: null, student: null, histIdx: null, id: null };
}

function saveCfLedgerEdit() {
  if (!cfLedgerEditing.type) return;
  const dateVal = document.getElementById('cf-ledger-edit-date').value;
  const amount  = round2(parseFloat(document.getElementById('cf-ledger-edit-amount').value) || 0);
  const note    = document.getElementById('cf-ledger-edit-note').value.trim();
  const desc    = document.getElementById('cf-ledger-edit-desc').value.trim();

  if (!dateVal) return eveAlert("Please select a date.", true);
  if (amount <= 0) return eveAlert("Please enter a valid amount.", true);

  if (cfLedgerEditing.type === 'income') {
    const rec = db.classFund.records[cfLedgerEditing.student];
    if (!rec || !rec.history[cfLedgerEditing.histIdx]) return eveAlert("That payment entry no longer exists.", true);
    const entry = rec.history[cfLedgerEditing.histIdx];
    entry.amount = amount;
    entry.date = dateVal;
    entry.note = note;
    rec.paid = round2(rec.history.reduce((sum, h) => sum + (Number(h.amount) || 0), 0));

    if (entry.id && Array.isArray(db.cashbook.transactions)) {
      const cbRow = db.cashbook.transactions.find(t => String(t.id) === String(entry.id));
      if (cbRow) { cbRow.amount = amount; cbRow.date = dateVal; }
    }
  } else {
    const txn = (db.classFund.transactions || []).find(t => String(t.id) === String(cfLedgerEditing.id));
    if (!txn) return eveAlert("That expense entry no longer exists.", true);
    if (!desc) return eveAlert("Please enter a description.", true);
    txn.date = dateVal;
    txn.amount = amount;
    txn.note = note;
    txn.description = desc;
  }

  saveData();
  closeCfLedgerEdit();
  renderClassFund();
  syncCfStudentsOverlay();
  syncCfLedgerOverlay();
  eveAlert("Transaction updated.");
}

function deleteCfLedgerEdit() {
  if (!cfLedgerEditing.type) return;
  if (!confirm("Delete this transaction? This cannot be undone.")) return;

  if (cfLedgerEditing.type === 'income') {
    const rec = db.classFund.records[cfLedgerEditing.student];
    if (rec && rec.history[cfLedgerEditing.histIdx]) {
      const removed = rec.history.splice(cfLedgerEditing.histIdx, 1)[0];
      rec.paid = round2(rec.history.reduce((sum, h) => sum + (Number(h.amount) || 0), 0));
      if (removed?.id) {
        db.cashbook.transactions = (db.cashbook.transactions || []).filter(t => String(t.id) !== String(removed.id));
      }
    }
  } else {
    db.classFund.transactions = (db.classFund.transactions || []).filter(t => String(t.id) !== String(cfLedgerEditing.id));
    db.cashbook.transactions  = (db.cashbook.transactions  || []).filter(t => String(t.id) !== String(cfLedgerEditing.id));
  }

  saveData();
  closeCfLedgerEdit();
  renderClassFund();
  syncCfStudentsOverlay();
  syncCfLedgerOverlay();
  eveAlert("Transaction deleted.");
}




  /* -------------------------------------------------------------------------
   WEEKLY BREAKDOWN — derives per-week payment status from history
   ------------------------------------------------------------------------- */
function getWeeklyBreakdown(history, weeklyDue) {
  const sorted = [...(history || [])].sort((a, b) =>
    (a.date || "").localeCompare(b.date || "")
  );
  const weeks = [];
  let currentWeek = 0;
  let weekPaid = 0;
  let weekDate = null;

  for (const entry of sorted) {
    let remaining = entry.amount;
    while (remaining > 0) {
      const space = weeklyDue - weekPaid;
      const alloc = Math.min(remaining, space);
      weekPaid += alloc;
      if (!weekDate) weekDate = entry.date;
      remaining -= alloc;

      if (weekPaid >= weeklyDue) {
        weeks[currentWeek] = { amount: weekPaid, date: weekDate, status: "full" };
        currentWeek++;
        weekPaid = 0;
        weekDate = null;
      }
    }
  }

  if (weekPaid > 0) {
    weeks[currentWeek] = { amount: weekPaid, date: weekDate, status: "partial" };
  }
  return weeks;
}

function getWeekRangeLabel(startDateStr, weekIndex) {
  const start = new Date(startDateStr + "T00:00:00");
  start.setDate(start.getDate() + (weekIndex * 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const day = start.toLocaleDateString('en-US', { weekday: 'long' });
  return {
    label: `Week ${weekIndex + 1} (${fmt(start)} - ${fmt(end)})`,
    startFmt: fmt(start),
    endFmt: fmt(end),
    dayName: day
  };
}

async function exportClassFundWeeklyCSV() {
  const cf = db.classFund;
  if (!cf.startDate || !cf.weeklyDue) {
    return eveAlert("Please set the weekly due amount and start date first.");
  }

  const totalWeeks = getExpectedWeeks(cf.startDate);
  if (totalWeeks === 0) return eveAlert("No collection weeks to export yet.");

  let csv = "";

  for (let w = 0; w < totalWeeks; w++) {
    const range = getWeekRangeLabel(cf.startDate, w);
    csv += `${w ? "\r\n" : ""}${range.label}\r\n`;
    csv += `Name,Date / Day,Payment Status\r\n`;

    const students = Object.keys(cf.records).sort();
    for (const name of students) {
      const rec = cf.records[name];
      const breakdown = getWeeklyBreakdown(rec.history || [], cf.weeklyDue);
      const weekInfo = breakdown[w] || { amount: 0, date: null, status: "unpaid" };

      let dateStr = "-";
      if (weekInfo.date) {
        const d = new Date(weekInfo.date + "T00:00:00");
        dateStr = `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (${d.toLocaleDateString('en-US', { weekday: 'long' })})`;
      }

      let statusStr = "Not Paid";
      if (weekInfo.status === "full") {
        statusStr = "Fully Paid";
      } else if (weekInfo.status === "partial") {
        const short = round2(cf.weeklyDue - weekInfo.amount);
        statusStr = `Short by ${peso(short)}`;
      }

      csv += `"${name.replace(/"/g, '""')}","${dateStr.replace(/"/g, '""')}","${statusStr.replace(/"/g, '""')}"\r\n`;
    }
  }

  // Optional trailing summary sheet
  csv += `\r\nSUMMARY\r\nName,Total Paid,Total Expected,Overall Status\r\n`;
  for (const name of Object.keys(cf.records).sort()) {
    const rec = cf.records[name];
    const expected = getClassFundExpected(name);
    const paid = rec.paid || 0;
    const balance = round2(expected - paid);
    let status = "Fully Paid";
    if (balance > 0) status = `Short by ${peso(balance)}`;
    else if (balance < 0) status = `Overpaid by ${peso(Math.abs(balance))}`;
    csv += `"${name.replace(/"/g, '""')}",${paid.toFixed(2)},${expected.toFixed(2)},"${status.replace(/"/g, '""')}"\r\n`;
  }

  const fileName = `class-fund-weekly-${new Date().toISOString().slice(0, 10)}.csv`;
  await exportFileCrossPlatform(csv, fileName, "text/csv", "Export Weekly Class Fund");
}

function renderClassFund() {
  const box = document.getElementById("classfund-list");
  const summary = document.getElementById("classfund-summary");
  const alertBox = document.getElementById("cf-missed-alert");
  const weekInfo = document.getElementById("cf-week-info");
  const txnBox = document.getElementById("cf-txn-log");
  if (!box || !summary) return;

  const cf = db.classFund;
  const weekly = cf.weeklyDue || 0;

  // Sync settings inputs
  const wInput = document.getElementById("cf-weekly-due");
  const sInput = document.getElementById("cf-start-date");
  if (wInput && (!wInput.value || wInput.value == "0")) wInput.value = weekly > 0 ? weekly : "";
  if (sInput && !sInput.value && cf.startDate) sInput.value = cf.startDate;

  const currentWeek = getExpectedWeeks(cf.startDate);
  if (weekInfo) {
    weekInfo.innerText = cf.startDate
      ? `Current Collection Week: Week ${currentWeek} • Weekly Due: ${peso(weekly)}`
      : "Set your weekly due and start date above to begin tracking.";
    weekInfo.style.color = cf.startDate ? "var(--accent)" : "var(--muted)";
  }

  const allStudents = Object.keys(cf.records || {}).sort();
  let totalExpected = 0, totalPaid = 0, missedCount = 0;
  allStudents.forEach(name => {
    totalExpected += getClassFundExpected(name);
    totalPaid += cf.records[name].paid || 0;
    missedCount += getMissedWeeks(name);
  });
  const totalUnpaid = round2(totalExpected - totalPaid);

  let students = allStudents;
  const searchInput = document.getElementById("cf-overlay-search") || document.getElementById("cf-search");
  const searchTerm = searchInput ? (searchInput.value || "").toLowerCase() : "";
  if (searchTerm) students = students.filter(n => n.toLowerCase().includes(searchTerm));

  const totalExpenses = round2((cf.transactions || [])
    .filter(t => t.type === "expense")
    .reduce((s, t) => s + (Number(t.amount) || 0), 0));
  const netBalance = round2(totalPaid - totalExpenses);

  summary.innerHTML = `
    <div class="summary-card"><h4>Total Collected</h4><p style="color:var(--success)">${peso(totalPaid)}</p></div>
    <div class="summary-card"><h4>Total Expenses</h4><p style="color:var(--danger)">${peso(totalExpenses)}</p></div>
    <div class="summary-card"><h4>Net Balance</h4><p style="color:${netBalance < 0 ? 'var(--danger)' : 'var(--accent-dark)'}">${peso(netBalance)}</p></div>
    <div class="summary-card"><h4>Enrolled</h4><p>${allStudents.length}</p></div>
  `;

  if (missedCount > 0 && totalUnpaid > 0) {
    alertBox.innerHTML = `
      <div class="missed-box">
        <h4>⚠ Collection Alert</h4>
        <p>${missedCount} total missed week(s) across all students</p>
        <span class="note">Unpaid student balance: ${peso(totalUnpaid)}</span>
      </div>
    `;
  } else {
    alertBox.innerHTML = "";
  }

  const countEl = document.getElementById("cf-count");
  if (countEl) countEl.innerText = `${students.length} student(s) shown • ${allStudents.length} enrolled in Class Fund`;

  if (students.length === 0) {
    box.innerHTML = `<p class="note">No students enrolled yet. Tap <b>+ Add All Students</b> above, or make sure students exist in the <b>Students</b> tab.</p>`;
  } else {
    box.innerHTML = students.map(name => {
      const rec = cf.records[name] || (cf.records[name] = { paid: 0, history: [] });
      rec.paid = Number(rec.paid) || 0;
      rec.history = Array.isArray(rec.history) ? rec.history : [];
      const expected = getClassFundExpected(name);
      const missed = getMissedWeeks(name);
      const balance = round2(expected - rec.paid);
      const lastPay = getLastPaymentDate(name);
      const safeId = encodeURIComponent(name);
      const isExpanded = cfExpandedNames.has(name);
      const lastPayText = lastPay ? `Last paid: ${formatDisplayDate(lastPay)}` : "Never paid";
      const progressPct = expected > 0 ? Math.min(100, (rec.paid / expected) * 100) : 0;

      return `
        <div class="cf-student-card ${isExpanded ? 'expanded' : ''}" id="cf-card-${safeId}" data-cf-name="${esc(name)}">
          <div class="cf-card-header-row" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
            <div>
              <div class="cf-name-badge-line" style="display:flex; align-items:center; gap:8px;">
                <span class="cf-student-title-name" style="font-weight:700;">${esc(name)}</span>
                <span class="cf-badge-minimal ${balance > 0 ? 'badg-warn' : 'badg-ok'}">${balance > 0 ? missed + ' weeks missed' : 'All Paid'}</span>
              </div>
              <div class="cf-minimal-subtext note">${lastPayText}</div>
            </div>
            <div class="cf-card-metrics-block" style="text-align:right;">
              <div class="cf-monospaced-bold-text ${balance > 0 ? 'txt-danger' : 'txt-success'}" style="font-weight:700;">${peso(rec.paid)}</div>
              <div class="cf-minimal-subtext note">of ${peso(expected)}</div>
              ${balance > 0 ? `<div class="cf-debt-indicator-line" style="color:var(--danger); font-size:11px;">-${peso(balance)}</div>` : ''}
            </div>
          </div>

          <div class="cf-details" id="cf-details-${safeId}" onclick="event.stopPropagation()" style="display:${isExpanded ? 'block' : 'none'}; width:100%; margin-top:12px;">
            <div class="minimal-progress-bar-container" style="background:rgba(0,0,0,0.05); height:6px; border-radius:3px; overflow:hidden; margin-bottom:10px;">
              <div class="minimal-progress-bar-fill" style="width:${progressPct}%; background:${balance > 0 ? '#b8872f' : '#166534'}; height:100%;"></div>
            </div>
            
            <div class="cf-payment-action-row-block">
              <button type="button" class="cf-minimalist-action-btn-trigger" onclick="openClassFundPaymentModal('${esc(name)}')">+ Add Payment</button>
            </div>
            
            ${rec.history.length > 0 ? `
              <div class="cf-minimalist-history-box-scroller">
                ${rec.history.map((h, hIdx) => `
                  <div class="cf-minimalist-history-entry-row">
                    <span class="cf-history-entry-log-text"><b>${peso(h.amount)}</b> on ${esc(formatDisplayDate(h.date))}</span>
                    <div class="cf-history-entry-actions-group">
                      <button type="button" class="cf-minimalist-del-action-btn" onclick="deleteClassFundPayment('${esc(name)}', ${hIdx})">DEL</button>
                    </div>
                  </div>
                `).reverse().join("")}  
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join("");
  }

  // --- Class Fund Ledger Section ---
  if (txnBox) {
    const incomeEntries = [];
    Object.entries(cf.records || {}).forEach(([name, rec]) => {
      (rec.history || []).forEach((h, idx) => {
        incomeEntries.push({
          sortKey: `${h.date || "0000-00-00"}-INC-${String(idx).padStart(4, '0')}-${name}`,
          type: "income",
          date: h.date,
          description: `Payment from ${name}`,
          amount: h.amount,
          note: h.note || "",
          student: name,
          histIdx: idx,
          deletable: false
        });
      });
    });

    const expenseEntries = (cf.transactions || [])
      .filter(t => t.type === "expense")
      .map(t => ({
        sortKey: `${t.date || "0000-00-00"}-EXP-${t.id}`,
        ...t,
        deletable: true
      }));

    const allTxns = [...incomeEntries, ...expenseEntries].sort((a, b) =>
      a.sortKey.localeCompare(b.sortKey)
    );

    let running = 0;
    const withBal = allTxns.map(t => {
      running = round2(running + (t.type === "income" ? t.amount : -t.amount));
      return { ...t, balance: running };
    }).reverse();

    if (withBal.length === 0) {
      txnBox.innerHTML = `<p class="note">No transactions yet. Record student payments or expenses above.</p>`;
    } else {
      txnBox.innerHTML = withBal.map(t => {
        const sign = t.type === "income" ? "+" : "−";
        const color = t.type === "income" ? "var(--success)" : "var(--danger)";
        const clickAttrs = t.type === "income"
          ? `data-cf-type="income" data-cf-student="${esc(t.student)}" data-cf-histidx="${t.histIdx}"`
          : `data-cf-type="expense" data-cf-id="${esc(t.id)}"`;

        return `
          <div class="item-row" ${clickAttrs} style="background:#fff; padding:12px 14px; border-bottom:1px solid rgba(0,0,0,0.05); display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
            <div style="text-align:left;">
              <b style="color:#1F2A24 !important;">${esc(t.description)}</b><br>
              <span class="note" style="color:#55625A !important; font-size:12px;">${esc(t.date)}${t.note ? ' • ' + esc(t.note) : ''}</span>
            </div>
            <div style="text-align:right;">
              <span style="color:${color}; font-weight:700; font-family:'IBM Plex Mono',monospace;">${sign}${peso(t.amount)}</span><br>
              <span class="note" style="color:#55625A !important; font-size:11px;">Bal: ${peso(t.balance)}</span>
            </div>
          </div>
        `;
      }).join("");

      txnBox.querySelectorAll('[data-cf-type]').forEach(el => {
        el.addEventListener('click', () => {
          if (el.dataset.cfType === 'income') {
            openCfLedgerEdit('income', el.dataset.cfStudent, parseInt(el.dataset.cfHistidx, 10));
          } else {
            openCfLedgerEdit('expense', el.dataset.cfId);
          }
        });
      });
    }
  }

  syncCfStudentsOverlay();
  syncCfLedgerOverlay();
}



function openCfStudentsOverlay() {
  const overlay = document.getElementById("cf-students-overlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");
  renderCfOverlayList();
}

function closeCfStudentsOverlay() {
  document.getElementById("cf-students-overlay")?.classList.add("hidden");
}

function renderCfOverlayList() {
  renderClassFund();
  syncCfStudentsOverlay();
}

/* =========================================================================
   PIECE 1: STATIC STUDENT ROW DIRECT COMPILATION CONTEXT
   ========================================================================= */
/* =========================================================================
   PIECE 2: ADAPTIVE TARGET RENDERING CONTAINER ASSIGNMENT ENGINE
   ========================================================================= */

function syncCfStudentsOverlay() {
  // Automatically identify the content pane target node across framework mutations
  const target = document.getElementById("cf-overlay-list") || 
                 document.querySelector("#studentsOverlay .modal-content") ||
                 document.querySelector("#cf-students-overlay .modal-body") ||
                 document.querySelector("#studentsOverlay div[style*='padding']");
                 
  if (!target) {
    console.error("Critical: Could not identify target container element inside your active Student Modal markup framework frames.");
    return;
  }

  const cf = db.classFund;
  const weekly = cf.weeklyDue || 0;
  const allStudents = Object.keys(cf.records || {}).sort();
  
  let students = allStudents;
  const searchInput = document.getElementById("cf-overlay-search") || document.getElementById("student-bucket-search");
  const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
  if (searchTerm) students = students.filter(n => n.toLowerCase().includes(searchTerm));

  if (students.length === 0) {
    target.innerHTML = `<p class="note" style="text-align:center; padding:30px 20px; color:#55625A!important; font-weight:600;">No students enrolled inside Class Fund tracking engine yet.<br><span style='font-size:12px; font-weight:400; color:var(--muted);'>Tap '+ Add All Students' on the background control dashboard to register your records.</span></p>`;
    return;
  }

  target.innerHTML = students.map(name => {
    const rec = cf.records[name];
    const expected = getClassFundExpected(name);
    const missed = getMissedWeeks(name);
    const balance = round2(expected - rec.paid);
    const lastPay = getLastPaymentDate(name);
    const isExpanded = cfExpandedNames.has(name);

    let statusBadge = "";
    if (missed > 2) statusBadge = `<span class="cf-badge cf-badge-danger">${missed} weeks missed</span>`;
    else if (missed > 0) statusBadge = `<span class="cf-badge cf-badge-warn">${missed} week missed</span>`;
    else if (balance < 0) statusBadge = `<span class="cf-badge cf-badge-info">Overpaid</span>`;
    else statusBadge = `<span class="cf-badge cf-badge-success">All Paid</span>`;

    const lastPayText = lastPay ? `Last paid: ${formatDisplayDate(lastPay)}` : "Never paid";
    const progressPct = expected > 0 ? Math.min(100, (rec.paid / expected) * 100) : 0;
    const progressColor = balance > 0 ? 'linear-gradient(90deg, var(--warning), var(--danger))' : 'linear-gradient(90deg, var(--success), var(--accent))';

    return `
      <div class="cf-student-card ${isExpanded ? 'expanded' : ''}" data-overlay-cf-name="${esc(name)}" style="background:#fff; padding:12px 14px; border-radius:var(--radius-sm); border:1px solid rgba(0,0,0,0.08); margin-bottom:10px; cursor:pointer; display:flex; flex-direction:column; gap:4px; text-align:left; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
          <div style="flex:1; min-width:0; padding-right:10px;">
            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:4px;">
              <b style="color:#1F2A24!important; font-size:15px; font-weight:700;">${esc(name)}</b>
              ${statusBadge}
            </div>
            <div class="note" style="font-size:12px; color:#55625A!important;">${lastPayText}</div>
          </div>
          <div style="display:flex; align-items:center; gap:12px; text-align:right;">
            <div>
              <div style="font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:16px; color:${balance > 0 ? 'var(--danger)' : 'var(--success)'}">${peso(rec.paid)}</div>
              <div class="note" style="font-size:11px; color:#55625A!important;">of ${peso(expected)}</div>
            </div>
            <div class="cf-chevron" style="font-size:12px; color:var(--muted); transform:${isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'};">▼</div>
          </div>
        </div>

        <div class="cf-details" style="margin-top:12px; padding-top:12px; border-top:1px dashed rgba(0,0,0,0.1); display:${isExpanded ? 'block' : 'none'}; width:100%;">
          <div class="progress-bar" style="height:6px; background:rgba(0,0,0,0.05); border-radius:3px; margin-bottom:12px; overflow:hidden; width:100%;">
            <div class="progress-fill" style="width:${progressPct}%; height:100%; background:${progressColor}; border-radius:3px;"></div>
          </div>
          <button class="btn-add-payment-trigger" style="width:100%; padding:10px; font-weight:600; background:var(--accent); color:#fff; border:none; border-radius:var(--radius-sm); cursor:pointer; font-size:13px; margin-bottom:10px;">+ Add Payment</button>
          
          ${rec.history.length > 0 ? `
            <div class="cf-history" style="display:flex; flex-direction:column; gap:6px; background:rgba(0,0,0,0.02); padding:10px; border-radius:4px; max-height:160px; overflow-y:auto; box-sizing:border-box; width:100%;">
              ${rec.history.slice().reverse().map((h, hIdx) => {
                const realIdx = rec.history.length - 1 - hIdx;
                return `
                  <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; padding:6px 0; border-bottom:1px solid rgba(0,0,0,0.04);">
                    <span style="color:#1F2A24!important;"><b>${peso(h.amount)}</b> on ${esc(formatDisplayDate(h.date))}</span>
                    <div style="display:flex; gap:6px;">
                      
                      <button class="mini-btn-delete" data-hist-idx="${realIdx}" style="padding:3px 8px; font-size:10px; font-weight:600; background:#b3423b; color:#fff; border:none; border-radius:3px; cursor:pointer;">DEL</button>
                    </div>
                  </div>
                `;
              }).join("")}  
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");

  // Map listeners cleanly
  _bindCfStudentOverlayListeners(target);
}


/* =========================================================================
   PIECE 2: DECOUPLED STUDENT CLICKS HOOK LOGIC
   ========================================================================= */
function _bindCfStudentOverlayListeners(targetContainer) {
  targetContainer.querySelectorAll('[data-overlay-cf-name]').forEach(card => {
    const sName = card.getAttribute('data-overlay-cf-name');
    
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      toggleClassFundDetail(encodeURIComponent(sName));
      syncCfStudentsOverlay(); 
    });

    const addPayBtn = card.querySelector('.btn-add-payment-trigger');
    if (addPayBtn) {
      addPayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openClassFundPaymentModal(sName);
      });
    }

    card.querySelectorAll('.mini-btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCfLedgerEdit('income', sName, btn.getAttribute('data-hist-idx'));
      });
    });

    card.querySelectorAll('.mini-btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteClassFundPayment(sName, parseInt(btn.getAttribute('data-hist-idx'), 10));
      });
    });
  });
}


/* =========================================================================
   FIXED LEDGER OVERLAY INTERFACE ROUTER — AUTOMATICALLY RENDERS LOGS
   ========================================================================= */
function openCfLedgerOverlay() {
  const overlay = document.getElementById("cf-ledger-overlay") || document.getElementById("ledgerOverlay");
  if (!overlay) {
    console.error("Critical: Could not find the ledger overlay container element in your HTML.");
    return;
  }

  // 1. Reveal the full-screen modal layer immediately
  overlay.classList.remove("hidden");
  overlay.classList.add("is-active"); 
  document.body.style.overflow = "hidden"; // Freeze background scrolling

  // 2. FORCE SYNC RUNTIME: Instantly extract, sort, and print out all logs
  if (typeof syncCfLedgerOverlay === "function") {
    syncCfLedgerOverlay();
  } else {
    console.error("Critical Execution Alert: 'syncCfLedgerOverlay()' transaction parser function not found.");
  }
}


/* =========================================================================
   PIECE 2: UNIFIED TRANSACTIONS COMPILATION AND CASCADING DELETION MATRIX
   ========================================================================= */

function syncCfLedgerOverlay() {
  const target = document.getElementById("cf-ledger-overlay-list") || document.getElementById("ledgerOverlayList");
  if (!target) return;

  const cf = db.classFund;
  const filter = document.getElementById("cf-ledger-filter")?.value || "all";

  // 1. Gather all student collection inputs cleanly
  const incomeEntries = [];
  Object.entries(cf.records || {}).forEach(([name, rec]) => {
    (rec.history || []).forEach((h, idx) => {
      incomeEntries.push({
        sortKey: `${h.date || "0000-00-00"}-INC-${String(idx).padStart(4, '0')}-${name}`,
        type: "income",
        date: h.date,
        description: `Payment from ${name}`,
        amount: h.amount,
        note: h.note || "",
        student: name,
        histIdx: idx,
        id: h.id
      });
    });
  });

  // 2. Gather all manual disbursement expense inputs
  const expenseEntries = (cf.transactions || [])
    .filter(t => t.type === "expense")
    .map(t => ({
      sortKey: `${t.date || "0000-00-00"}-EXP-${t.id}`,
      ...t
    }));

  // 3. Sort records chronologically
  let allTxns = [...incomeEntries, ...expenseEntries].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  // 4. Compute running cash balances sequentially
  let running = 0;
  let withBal = allTxns.map(t => {
    running = round2(running + (t.type === "income" ? t.amount : -t.amount));
    return { ...t, balance: running };
  }).reverse(); // Display freshest records on top of scroll block

  if (filter !== "all") {
    withBal = withBal.filter(t => t.type === filter);
  }

  if (withBal.length === 0) {
    target.innerHTML = `<p class="note" style="text-align:center; padding:24px; color:var(--muted);">No transactions found in this ledger view filter.</p>`;
    return;
  }

  // 5. Inject clean, unclickable template rows with target execution buttons
  target.innerHTML = withBal.map(t => {
    const sign = t.type === "income" ? "+" : "−";
    const color = t.type === "income" ? "var(--success)" : "var(--danger)";
    
/* =========================================================================
   FIXED IN-FUNCTION CSS MARGIN STRUCTURAL BLUEPRINT
   ========================================================================= */
return `
  <div class="overlay-ledger-row" style="background:var(--surface,#fff); padding:12px 14px; border-bottom:1px solid var(--hairline,rgba(31,42,36,0.1)); display:flex; justify-content:space-between; align-items:center; box-sizing:border-box; width:100%;">
    
    <!-- Left Column: Transaction Label Descriptions -->
    <div style="text-align:left; flex:1; min-width:0; padding-right:12px; display:flex; flex-direction:column; justify-content:center;">
      <b style="color:var(--ink,#1F2A24)!important; font-size:14px; font-weight:600; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin:0; padding:0; line-height:1.3;">${esc(t.description)}</b>
      <span class="note" style="color:var(--muted,#6E7A72)!important; font-size:12px; display:block; margin-top:2px; line-height:1.2;">${esc(t.date)}${t.note ? ' • ' + esc(t.note) : ''}</span>
    </div>
    
    <!-- Right Column: Aligned Metrics Row Stack and Integrated Delete Cross Button -->
    <div style="display:flex; align-items:center; gap:16px; flex-shrink:0; height:100%;">
      
      <!-- Value Stack Panel Container -->
      <div style="text-align:right; display:flex; flex-direction:column; justify-content:center; gap:1px; line-height:1.1;">
        <span style="color:${color}; font-weight:600; font-family:'IBM Plex Mono',monospace; font-size:15px; display:block; white-space:nowrap; margin:0; padding:0;">${sign}${peso(t.amount)}</span>
        <span class="note" style="color:var(--muted,#6E7A72)!important; font-size:11px; display:block; white-space:nowrap; margin:0; padding:0;">Bal: ${peso(t.balance)}</span>
      </div>
      
      <!-- Perfectly Centered Minimalist Red Delete (X) Touch Trigger Element Button -->
      <button type="button" class="cf-ledger-row-x-action" 
              data-tx-type="${t.type}" 
              data-tx-student="${esc(t.student || '')}" 
              data-tx-id="${esc(t.id || '')}"
              data-tx-desc="${esc(t.description)}"
              data-tx-amt="${t.amount}"
              style="background:none; border:none; color:var(--danger,#b3423b); font-family:'Inter',sans-serif; font-size:22px; font-weight:500; cursor:pointer; width:32px; height:32px; min-height:32px; display:flex; align-items:center; justify-content:center; padding:0; margin:0; line-height:1; transition:all 0.15s ease; border-radius:4px;">×</button>
              
    </div>
  </div>
`;

  }).join("");

  // 6. Bind isolated event listeners to the fresh nodes
  target.querySelectorAll('.cf-ledger-row-x-action').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      const type = btn.getAttribute('data-tx-type');
      const txId = btn.getAttribute('data-tx-id');
      const desc = btn.getAttribute('data-tx-desc');
      const amt = parseFloat(btn.getAttribute('data-tx-amt') || '0');
      
      const confirmDelete = confirm(`Are you sure you want to permanently delete this transaction?\n\n"${desc}" for ${peso(amt)}?\n\nThis will instantly re-calculate running balances.`);
      if (!confirmDelete) return;

      if (type === 'income') {
        const studentName = btn.getAttribute('data-tx-student');
        
        // Remove payment item completely from the target student's profile array
        if (cf.records[studentName]) {
          const rec = cf.records[studentName];
          rec.history = (rec.history || []).filter(h => h.id !== txId);
          // Force balance calculation sync
          rec.paid = round2(rec.history.reduce((sum, h) => sum + (Number(h.amount) || 0), 0));
        }
      } 
      
      // Clear record item entirely out of master transactions repository
      cf.transactions = (cf.transactions || []).filter(t => t.id !== txId);
      
      // Save data down into browser localStorage variables and force a full screen refresh
      saveData();
      
      if (typeof renderClassFund === "function") renderClassFund();
      if (typeof syncCfStudentsOverlay === "function") syncCfStudentsOverlay();
      
      // Refresh this ledger log pop-up list view instantly
      syncCfLedgerOverlay();
      
      if (typeof eveAlert === "function") eveAlert("Transaction cleared from history successfully.");
    });
  });
}



/* =========================================================================
   PIECE 4: DECOUPLED TRANSACTION EDITOR CLICKS ROUTER
   ========================================================================= */
function _bindCfLedgerOverlayInterceptors(targetContainer) {
  targetContainer.querySelectorAll('.overlay-ledger-row').forEach(row => {
    row.addEventListener('click', () => {
      const type = row.getAttribute('data-tx-type');
      if (type === 'income') {
        openCfLedgerEdit('income', row.getAttribute('data-tx-student'), row.getAttribute('data-tx-idx'));
      } else {
        openCfLedgerEdit('expense', row.getAttribute('data-tx-id'));
      }
    });
  });
}


/* =========================================================================
   PIECE 1: UNIFIED MODAL OPEN / CLOSE COMPILATION ENGINE
   ========================================================================= */

function openCfStudentsOverlay() {
  // Grab references to all potential modal container ID targets
  const overlay1 = document.getElementById("cf-students-overlay");
  const overlay2 = document.getElementById("studentsOverlay");

  if (overlay1) overlay1.classList.remove("hidden");
  if (overlay2) overlay2.classList.add("is-active");
  
  document.body.style.overflow = "hidden"; // Block background page scrolling

  // Fire our direct database array renderer loop mechanics instantly
  if (typeof syncCfStudentsOverlay === "function") {
    syncCfStudentsOverlay();
  }
}

function closeCfStudentsOverlay() {
  const overlay1 = document.getElementById("cf-students-overlay");
  const overlay2 = document.getElementById("studentsOverlay");

  if (overlay1) overlay1.classList.add("hidden");
  if (overlay2) overlay2.classList.remove("is-active");
  
  document.body.style.overflow = ""; // Restore baseline body page scrolling
}



function closeCfLedgerOverlay() {
  const overlay1 = document.getElementById("cf-ledger-overlay");
  const overlay2 = document.getElementById("ledgerOverlay");

  if (overlay1) overlay1.classList.add("hidden");
  if (overlay2) overlay2.classList.remove("is-active");
  
  document.body.style.overflow = "";
}



  function deleteStudent(name) {
  const label = lbl("year level").toLowerCase();
  if (!confirm(`Remove "${name}" from the database? They will also be removed from all collections.`)) return;
  Object.keys(db.categories).forEach(cat => {
    db.categories[cat].records = db.categories[cat].records.filter(r => r.name !== name);
  });
  db.students = db.students.filter(s => s.name !== name);
  saveData();
  renderStudents();
  renderSummary();
}

  function renderStudents() {
    const list = document.getElementById("student-db-list");
    if (!list) return;
    const searchTerm = (document.getElementById("search-students-db")?.value || "").toLowerCase();
    const matches = [...db.students]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter(s => s.name.toLowerCase().includes(searchTerm));

      const countLabel = db.students.length === 1
    ? `1 ${lbl("year level").toLowerCase()} in the database`
    : `${db.students.length} ${lbl("year levels").toLowerCase()} in the database`;
  document.getElementById("student-count").innerText = countLabel;

  // ... inside the if (matches.length === 0) block:
  if (matches.length === 0) {
    list.innerHTML = `<p class="note">${db.students.length === 0 ? 'No ' + lbl("year level").toLowerCase() + ' added yet.' : 'No matching ' + lbl("year level").toLowerCase() + '.'}</p>`;
    return;
  }

    list.innerHTML = matches.map(s => {
      const count = getYearLevelStudentCount(s);
      const countLabel = isOrg()
        ? ` <span class="note" style="font-weight:600;">(${count} student${count === 1 ? '' : 's'})</span>`
        : "";
      return `
      <div class="card" data-student-name="${esc(s.name)}">
        <span>${esc(s.name)}${countLabel}</span>
        <button class="del-btn" data-action="delete-student" data-name="${esc(s.name)}">X</button>
      </div>`;
    }).join("");

    // Attach event listeners instead of inline onclick
    list.querySelectorAll('.card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="delete-student"]')) return;
        showStudentProfile(card.dataset.studentName);
      });
    });
    list.querySelectorAll('[data-action="delete-student"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteStudent(btn.dataset.name);
      });
    });
  }

  // ================= STUDENT PROFILE (BALANCE ACROSS ALL COLLECTIONS) =================
  function showStudentProfile(name) {
    const student = db.students.find(s => s.name === name);
      if (!student) {
    eveAlert(lbl("Year Level") + " not found. They may have been deleted.", true);
    return;
  }

    document.getElementById("student-list-view").classList.add("hidden");
    document.getElementById("student-profile-view").classList.remove("hidden");
    document.getElementById("profile-student-name").innerText = esc(name);

    renderStudentProfile(name);
  }

  function getOpenYearLevel() {
    const name = document.getElementById("profile-student-name")?.innerText.trim();
    return db.students.find(s => s.name === name);
  }

  function renderOrgRosterFullscreen() {
    const yearLevel = getOpenYearLevel();
    const box = document.getElementById("org-roster-fullscreen-list");
    if (!yearLevel || !box) return;
    const roster = Array.isArray(yearLevel.students) ? yearLevel.students : [];
    document.getElementById("org-roster-title").innerText = `${yearLevel.name} Students`;
    const search = (document.getElementById("org-roster-search")?.value || "").toLowerCase();
    const matches = roster
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .filter(student => student.name.toLowerCase().includes(search));
    box.innerHTML = matches.length ? matches.map(student => `
            <div class="roster-row">
        <div><b>${esc(student.name)}</b></div>
        <div class="roster-actions">
          <button class="del-btn" data-roster-remove="${esc(student.id)}" type="button">X</button>
        </div>
      </div>`).join("") : `<p class="note">No named students yet. Add them individually or paste a comma-separated list above.</p>`;
    box.querySelectorAll("[data-roster-remove]").forEach(button => button.addEventListener("click", () => removeOrgRosterStudent(button.dataset.rosterRemove)));
  }

  function viewOrgRosterStudent(studentId) {
    const yearLevel = getOpenYearLevel();
    const student = yearLevel?.students?.find(item => String(item.id) === String(studentId));
    const box = document.getElementById("org-roster-fullscreen-list");
    if (!yearLevel || !student || !box) return;
    const rows = Object.entries(db.categories).map(([category, data]) => {
      const record = (data.records || []).find(item => item.name === yearLevel.name);
      if (!record) return "";
      return `<div class="roster-row"><div><b>${esc(category)}</b><span class="note">${peso(record.paid)} paid of ${peso(record.due)}</span></div><strong>${record.paid >= record.due ? "Paid" : "Unpaid"}</strong></div>`;
    }).filter(Boolean).join("");
    box.innerHTML = `<div class="item-summary"><b>${esc(student.name)}</b><br><span class="note">${student.paymentStatus === "paid" ? "Paid" : "Unpaid"}</span></div>${rows || '<p class="note">No collection records yet.</p>'}<button class="full-btn" onclick="renderOrgRosterFullscreen()">Back to Students</button>`;
  }

  function openOrgRosterFullscreen() {
    if (!isOrg()) return;
    document.getElementById("org-roster-fullscreen")?.classList.remove("hidden");
    renderOrgRosterFullscreen();
  }

  function closeOrgRosterFullscreen() {
    document.getElementById("org-roster-fullscreen")?.classList.add("hidden");
  }

  function addOrgRosterNames(names) {
    const yearLevel = getOpenYearLevel();
    if (!yearLevel) return;
    yearLevel.students = Array.isArray(yearLevel.students) ? yearLevel.students : [];
    names.map(name => name.trim()).filter(Boolean).forEach(name => {
      if (!yearLevel.students.some(student => student.name.toLowerCase() === name.toLowerCase())) {
        yearLevel.students.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2, 8), name, profile: "", paymentStatus: "unpaid" });
      }
    });
    syncYearLevelCollectionDues(yearLevel);
    saveData();
    renderStudents();
    renderStudentProfile(yearLevel.name);
    renderOrgRosterFullscreen();
  }

  function addOrgRosterBulk() {
    const input = document.getElementById("org-roster-bulk-input");
    addOrgRosterNames((input?.value || "").split(","));
    if (input) input.value = "";
  }

  function saveOrgPerStudentAmount() {
    const yearLevel = getOpenYearLevel();
    const amount = round2(parseFloat(document.getElementById("org-roster-amount").value) || 0);
    if (!yearLevel || amount < 0) return;
    yearLevel.perStudentAmount = amount;
    Object.values(db.categories).forEach(category => {
      const record = (category.records || []).find(item => item.name === yearLevel.name);
      if (record && getYearLevelStudentCount(yearLevel) > 0) record.due = getYearLevelTotalDue(yearLevel, record.due);
    });
    saveData();
    renderStudents();
    renderStudentProfile(yearLevel.name);
    renderOrgRosterFullscreen();
    eveAlert("Amount per student saved.");
  }

  function addOrgRosterStudentFromFullscreen() {
    const input = document.getElementById("org-roster-name-input");
    addOrgRosterNames([input?.value || ""]);
    if (input) input.value = "";
  }

  function removeOrgRosterStudent(studentId) {
    const yearLevel = getOpenYearLevel();
    const student = yearLevel?.students?.find(item => String(item.id) === String(studentId));
    if (!yearLevel || !student || !confirm(`Remove ${student.name} from this year level?`)) return;
    yearLevel.students = yearLevel.students.filter(item => String(item.id) !== String(studentId));
    syncYearLevelCollectionDues(yearLevel);
    saveData();
    renderStudents();
    renderStudentProfile(yearLevel.name);
    renderOrgRosterFullscreen();
  }

  function syncYearLevelCollectionDues(yearLevel) {
    Object.values(db.categories).forEach(category => {
      const record = (category.records || []).find(item => item.name === yearLevel.name);
      if (record) record.due = getYearLevelTotalDue(yearLevel, record.due);
    });
  }

  function toggleOrgRosterStatus(studentId) {
    const yearLevel = getOpenYearLevel();
    const student = yearLevel?.students?.find(item => String(item.id) === String(studentId));
    if (!yearLevel || !student || !confirm(`Mark ${student.name} as ${student.paymentStatus === "paid" ? "unpaid" : "paid"}?`)) return;
    student.paymentStatus = student.paymentStatus === "paid" ? "unpaid" : "paid";
    saveData();
    renderOrgRosterFullscreen();
    renderStudentProfile(yearLevel.name);
  }

  function saveStudentCount() {
    const nameEl = document.getElementById("profile-student-name");
    const name = nameEl ? nameEl.innerText : "";
    const student = db.students.find(s => s.name === name);
    if (!student) return;

    const countInput = document.getElementById("profile-student-count");
    if (!countInput) return;
    const val = countInput ? countInput.value.trim() : "";

    if (val === "") {
      delete student.studentCount;
    } else {
      student.studentCount = Math.max(0, Math.round(parseFloat(val) || 0));
    }

    saveData();
    renderStudents();
    eveAlert("Student count saved.");
  }

  function backToStudentList() {
    document.getElementById("student-profile-view").classList.add("hidden");
    document.getElementById("student-list-view").classList.remove("hidden");
  }

  function renderStudentProfile(name) {
    const yearLevel = db.students.find(student => student.name === name);
    const cats = Object.keys(db.categories).sort((a, b) => a.localeCompare(b));
    let totalDue = isOrg() && yearLevel ? getYearLevelTotalDue(yearLevel) : 0, totalPaid = 0;

    const rows = cats.map(cat => {
      const c = db.categories[cat];
      const rec = c.records.find(r => r.name === name);
      if (!rec) return "";
      if (!isOrg()) totalDue += rec.due;
      totalPaid += rec.paid;
      const balance = round2(rec.due - rec.paid);

      let statusLabel, statusColor;
      if (balance < 0) { statusLabel = "OVERPAID"; statusColor = "#3B6E8F"; }
      else if (balance === 0) { statusLabel = "PAID"; statusColor = "#2F7D53"; }
      else if (rec.paid > 0) { statusLabel = "PARTIAL"; statusColor = "#B8872F"; }
      else { statusLabel = "UNPAID"; statusColor = "#B3423B"; }

      return `
        <div class="breakdown-card">
          <div class="breakdown-top"><b>${esc(cat)}</b><span style="color:${statusColor};">${peso(rec.paid)} / ${peso(rec.due)} — ${statusLabel}</span></div>
        </div>`;
    }).filter(Boolean).join("");

    const overallBalance = round2(totalDue - totalPaid);

    const profileSummary = document.getElementById("profile-summary");
    if (profileSummary) {
      profileSummary.innerHTML = isOrg() ? "" : `
        <div class="summary-card"><h4>Total Due</h4><p>${peso(totalDue)}</p></div>
        <div class="summary-card"><h4>Total Paid</h4><p>${peso(totalPaid)}</p></div>
        <div class="summary-card" style="grid-column: span 2;"><h4>Overall Balance</h4><p style="color:${overallBalance > 0 ? '#B3423B' : '#2F7D53'}">${peso(overallBalance)}</p></div>
      `;
    }

     document.getElementById("profile-breakdown").innerHTML = rows || `<p class="note">This ${lbl("year level").toLowerCase()} isn't part of any collection yet.</p>`;
  }

  // ================= CATEGORY (COLLECTION) PICKER =================
  function addCategory() {
    const catInput = document.getElementById("new-category");
    const dueInput = document.getElementById("new-category-due");
    const cat = catInput.value.trim();
    const due = round2(parseFloat(dueInput.value) || 0);

    if (!cat) return eveAlert("Please enter a collection name (e.g. Newsette Fee)", true);
    if (findCategoryKeyCI(cat)) return eveAlert("This collection already exists (names are not case-sensitive).", true);
    if (due <= 0) return eveAlert("Please enter a valid amount per student", true);

    db.categories[cat] = { amountDue: due, records: [] };
    catInput.value = "";
    dueInput.value = "";

    // 🌟 Reuse whatever students/year levels are already saved on the
    // Student Database (Year Level tab) — auto-populate every new
    // collection with them so they don't need to be re-added manually.
    const catObj = db.categories[cat];
    const existingNames = getCollectionRecordNames(catObj);
    getAddAllStudents().forEach(student => {
      if (existingNames.has(student.name.toLowerCase())) return;
      catObj.records.push({
        name: student.name,
        due: getYearLevelTotalDue(student, catObj.amountDue),
        paid: 0,
        history: [],
        yearLevelId: student.id || null
      });
      existingNames.add(student.name.toLowerCase());
    });

    saveData();
    
    // 🌟 FIX: Instantly redraw the Records Tab list view without a manual refresh
    renderCategories();
    
    if (isOrg()) populateAddRemittanceForm();
    eveAlert("Collection Added!");
  }


function renameCategory() {
  document.getElementById("rename-old-name").innerText = currentCategory;
  document.getElementById("rename-input").value = currentCategory;
  document.getElementById("rename-error").innerText = "";
  document.getElementById("rename-modal").classList.remove("hidden");
  document.getElementById("rename-input").focus();
}

function closeRenameModal() {
  document.getElementById("rename-modal").classList.add("hidden");
}

function confirmRenameCategory() {
  const newNameRaw = document.getElementById("rename-input").value;
  const errorEl = document.getElementById("rename-error");
  const newName = newNameRaw.trim();

  if (!newName) { errorEl.innerText = "Name cannot be empty."; return; }
  if (newName === currentCategory) { closeRenameModal(); return; }

  if (newName.toLowerCase() !== currentCategory.toLowerCase() && findCategoryKeyCI(newName)) {
    errorEl.innerText = "A collection with that name already exists.";
    return;
  }

  db.categories[newName] = db.categories[currentCategory];
  delete db.categories[currentCategory];
  currentCategory = newName;
  saveData();
  document.getElementById("item-view-title").innerText = newName.toUpperCase();
  renderItemList();
  closeRenameModal();
}

function filterCategories() {
    const inputEl = document.getElementById("category-search");
    const input = inputEl.value.toLowerCase();

    // If the visible text no longer exactly matches the currently selected
    // collection, clear the hidden selection so a payment can never be
    // recorded against a stale/deleted selection.
    const selectedVal = document.getElementById("category-select").value;
    if (selectedVal && inputEl.value !== selectedVal) {
      document.getElementById("category-select").value = "";
    }

    const dropdown = document.getElementById("category-list-dropdown");
    const cats = Object.keys(db.categories).filter(c => c.toLowerCase().includes(input));
    dropdown.innerHTML = "";

    if (Object.keys(db.categories).length === 0) {
      dropdown.innerHTML = `<div style="color:#6E7A72; cursor:default;">No collections yet — add one above first.</div>`;
    } else if (cats.length === 0) {
      dropdown.innerHTML = `<div style="color:#6E7A72; cursor:default;">No collection found</div>`;
    } else {
      cats.forEach(c => {
        dropdown.innerHTML += `<div data-cat="${esc(c)}">${esc(c)} <span class="note">(Due: ${peso(db.categories[c].amountDue)})</span></div>`;
      });
      dropdown.querySelectorAll('div[data-cat]').forEach(div => {
        div.addEventListener('click', () => selectCategory(div.dataset.cat));
      });
    }
    dropdown.classList.add("show");
  }

  function selectCategory(cat) {
    document.getElementById("category-search").value = cat;
    document.getElementById("category-select").value = cat;
    document.getElementById("category-list-dropdown").classList.remove("show");
  }

  // ================= STUDENT PICKER — used in the former Add tab (payment picker, no longer active) =================
  function filterStudentPicker() {
    const input = document.getElementById("student-search").value.toLowerCase();
    const dropdown = document.getElementById("student-list-dropdown");
    const matches = getOrgRosterEntries().filter(s => {
      const bucket = yearLevelBucket(s.yearLevel);
      return s.name.toLowerCase().includes(input) && (isClass() || addYearFilter === "all" || bucket === addYearFilter);
    });
    dropdown.innerHTML = "";

    if (getOrgRosterEntries().length === 0) {
      dropdown.innerHTML = `<div style="color:#6E7A72; cursor:default;">No students yet — add them in the database first.</div>`;
    } else if (matches.length === 0) {
      dropdown.innerHTML = `<div style="color:#6E7A72; cursor:default;">No match found</div>`;
    } else {
      matches.forEach(s => {
        const label = s.legacyYearLevel ? s.name : `${s.name} (${s.yearLevel})`;
        dropdown.innerHTML += `<div data-student="${esc(s.name)}">${esc(label)}</div>`;
      });
      dropdown.querySelectorAll('div[data-student]').forEach(div => {
        div.addEventListener('click', () => selectStudent(div.dataset.student));
      });
    }
    dropdown.classList.add("show");
  }

  function setAddYearFilter(value) {
    addYearFilter = value || "all";
    filterStudentPicker();
  }

  function selectStudent(name) {
    document.getElementById("student-search").value = name;
    document.getElementById("student-select").value = name;
    document.getElementById("student-list-dropdown").classList.remove("show");
  }

  // ================= PROJECT PICKER — used in Cashbook tab =================
  function filterProjectPicker() {
    const input = document.getElementById("txn-project-search").value.toLowerCase();
    const dropdown = document.getElementById("txn-project-dropdown");
    const matches = db.projects.filter(p => p.name.toLowerCase().includes(input));
    dropdown.innerHTML = "";

    dropdown.innerHTML += `<div data-project-id="" data-project-name="">— No Project (General Fund) —</div>`;
    if (db.projects.length === 0) {
      dropdown.innerHTML += `<div style="color:#6E7A72; cursor:default;">No projects yet — add one from "Projects &amp; Events".</div>`;
    } else {
      matches.forEach(p => {
        dropdown.innerHTML += `<div data-project-id="${esc(p.id)}" data-project-name="${esc(p.name)}">${esc(p.name)}</div>`;
      });
    }
    dropdown.querySelectorAll('div[data-project-id]').forEach(div => {
      div.addEventListener('click', () => selectProjectForTxn(div.dataset.projectId, div.dataset.projectName));
    });
    dropdown.classList.add("show");
  }

  function selectProjectForTxn(id, name) {
    document.getElementById("txn-project-search").value = id ? name : "";
    document.getElementById("txn-project-select").value = id || "";
    document.getElementById("txn-project-dropdown").classList.remove("show");
  }

  window.onclick = function (event) {
    if (!event.target.closest('#category-search')) {
      document.getElementById("category-list-dropdown").classList.remove("show");
    }
    if (!event.target.closest('#student-search')) {
      document.getElementById("student-list-dropdown").classList.remove("show");
    }
    if (!event.target.closest('#txn-project-search')) {
      const d = document.getElementById("txn-project-dropdown");
      if (d) d.classList.remove("show");
    }
  };

  function populateAddRemittanceForm() {
    if (!document.getElementById("add-remittance-collection-search")) return;
    document.getElementById("add-remittance-collection-search").value = document.getElementById("add-remittance-collection").value || "";
    document.getElementById("add-remittance-year-level-search").value = document.getElementById("add-remittance-year-level").value || "";
    const date = document.getElementById("add-remittance-date");
    if (date && !date.value) date.value = new Date().toISOString().slice(0, 10);
  }

  function filterOrgRemittanceCollection() {
    const input = document.getElementById("add-remittance-collection-search");
    const dropdown = document.getElementById("add-remittance-collection-dropdown");
    if (!input || !dropdown) return;
    const query = input.value.toLowerCase();
    const matches = Object.keys(db.categories).filter(category => category.toLowerCase().includes(query));
    dropdown.innerHTML = matches.length ? matches.map(category => `<div data-remittance-collection="${esc(category)}">${esc(category)}</div>`).join("") : `<div class="note">No collection found.</div>`;
    dropdown.querySelectorAll("[data-remittance-collection]").forEach(item => item.addEventListener("click", () => {
      document.getElementById("add-remittance-collection").value = item.dataset.remittanceCollection;
      input.value = item.dataset.remittanceCollection;
      dropdown.classList.remove("show");
    }));
    dropdown.classList.add("show");
  }

  function filterOrgRemittanceYearLevel() {
    const input = document.getElementById("add-remittance-year-level-search");
    const dropdown = document.getElementById("add-remittance-year-level-dropdown");
    if (!input || !dropdown) return;
    const query = input.value.toLowerCase();
    const matches = db.students.filter(yearLevel => yearLevel.name.toLowerCase().includes(query));
    dropdown.innerHTML = matches.length ? matches.map(yearLevel => `<div data-remittance-year-level="${esc(yearLevel.name)}">${esc(yearLevel.name)}</div>`).join("") : `<div class="note">No year level found.</div>`;
    dropdown.querySelectorAll("[data-remittance-year-level]").forEach(item => item.addEventListener("click", () => {
      document.getElementById("add-remittance-year-level").value = item.dataset.remittanceYearLevel;
      input.value = item.dataset.remittanceYearLevel;
      dropdown.classList.remove("show");
    }));
    dropdown.classList.add("show");
  }

 function saveAddRemittance() {
  const category = document.getElementById("add-remittance-collection").value;
  const yearLevelName = document.getElementById("add-remittance-year-level").value;
  const amount = round2(parseFloat(document.getElementById("add-remittance-amount").value) || 0);
  
  if (!category || !db.categories[category] || !yearLevelName || amount <= 0) {
    return eveAlert("Choose a collection and year level, then enter a valid amount.", true);
  }
  
  const date = document.getElementById("add-remittance-date").value || new Date().toISOString().slice(0, 10);
  const note = document.getElementById("add-remittance-note").value.trim();
  const catObj = db.categories[category];
  const yearLevel = db.students.find(student => student.name === yearLevelName);
  
  let record = catObj.records.find(item => item.name === yearLevelName);
  if (!record) {
    record = { 
      name: yearLevelName, 
      due: getYearLevelTotalDue(yearLevel, catObj.amountDue), 
      paid: 0, 
      history: [], 
      yearLevelId: yearLevel?.id || null 
    };
    catObj.records.push(record);
  }
  
  const transactionId = "TX-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  
  record.paid = round2(record.paid + amount);
  record.history.push({ 
    id: transactionId, 
    amount, 
    date, 
    note: note || "Year-Level Remittance" 
  });
  
  // Stored strictly as type "remittance" to keep it separated from standard income/expenses logs
  db.cashbook.transactions.push({
    id: transactionId,
    type: "remittance",
    date,
    orNumber: "",
    category,
    description: `Remittance from ${yearLevelName}`,
    amount,
    projectId: null,
    notes: note
  });
  
  saveData();
  document.getElementById("add-remittance-amount").value = "";
  document.getElementById("add-remittance-note").value = "";
  renderCategories();
  renderCashbookSummary();
  renderCashbookList();
  populateAddRemittanceForm();
  renderSummary(); // Forces dynamic update of overview cards
  eveAlert(`Remittance of ${peso(amount)} from ${yearLevelName} recorded.`);
}

  // ================= RECORD A PAYMENT =================
function recordPayment() {
  const cat = document.getElementById("category-select").value;
  const student = document.getElementById("student-select").value;
  const amountPaying = round2(parseFloat(document.getElementById("amount-paying").value) || 0);
  const note = document.getElementById("payment-note").value.trim();

  if (!cat || !db.categories[cat]) return eveAlert("Please pick a valid collection from the list", true);
  if (!student || !getOrgRosterEntries().some(s => s.name === student)) return eveAlert("Please pick a valid student from the database", true);
  if (amountPaying <= 0) return eveAlert("Please enter a positive amount", true);

  const catObj = db.categories[cat];
  let record = catObj.records.find(r => r.name === student);

  if (!record) {
    record = { name: student, due: catObj.amountDue, paid: 0, history: [] };
    catObj.records.push(record);
  }

  // FIXED: Generate a unique ID to tie history straight to cashbook logs
  const paymentId = "PAY-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  const payDate = document.getElementById("payment-date").value || new Date().toISOString().slice(0, 10);
  
  record.paid = round2(record.paid + amountPaying);
  record.history.push({ id: paymentId, amount: amountPaying, date: payDate, note: note || "" });

  if (isOrg()) {
    // FIXED: Correctly saving type as "remittance" when recorded directly inside collections
    db.cashbook.transactions.push({
      id: paymentId,
      type: "remittance", 
      date: payDate,
      orNumber: "",
      category: "Year Levels Payment",
      description: `Payment from ${student} — ${cat}`,
      amount: amountPaying,
      projectId: null,
      notes: note || ""
    });
  }

  saveData();
  
  // FIXED: Recalculate views and dashboard counter statistics instantly
  renderCategories();
  renderCashbookSummary();
  renderCashbookList();
  renderSummary(); 
  if (typeof generateStatement === "function") generateStatement();

  document.getElementById("payment-note").value = "";
  document.getElementById("payment-date").value = new Date().toISOString().slice(0, 10);
  if (document.getElementById("amount-paying")) document.getElementById("amount-paying").value = "";
  
  eveAlert(`Payment of ${peso(amountPaying)} from ${student} recorded!`);
}

function renderCategories() {
  const list = document.getElementById("category-list");
  const alphaIndex = document.getElementById("alpha-index");
  if (!list || !alphaIndex) return;

  list.innerHTML = "";
  alphaIndex.innerHTML = "";

  const categories = Object.keys(db.categories).sort((a, b) => a.localeCompare(b));
  if (categories.length === 0) {
    list.innerHTML = `<p class="note">No collections yet. Add one using the box above.</p>`;
    return;
  }

  // Group collections by their starting letter
  const grouped = {};
  categories.forEach(cat => {
    const letter = cat[0].toUpperCase();
    (grouped[letter] = grouped[letter] || []).push(cat);
  });

  // 1. GATHER ALL HTML IN STRINGS FIRST TO PREVENT DOM BREAKAGE
  let fullListHtml = "";
  let fullAlphaHtml = "";

  Object.keys(grouped).sort().forEach(letter => {
    let groupCardsHtml = "";

    grouped[letter].forEach(cat => {
      const c = db.categories[cat];
      const totalDue = c.records.reduce((s, r) => s + r.due, 0);
      const totalPaid = c.records.reduce((s, r) => s + r.paid, 0);
      
      const tOutAll = (db.transfers || []).filter(t => t.from === cat).reduce((s, t) => s + t.amount, 0);
      const tInAll = (db.transfers || []).filter(t => t.to === cat).reduce((s, t) => s + t.amount, 0);
      const netAll = round2(totalPaid + tInAll - tOutAll);

      const remitStatus = c.remittanceStatus || "unremitted";
      const remitNote = c.remittanceNotes || "";
      const isRemitted = remitStatus === "remitted";
      
      const statusIndicatorIcon = isRemitted ? "🟢" : "⭕";
      const statusLabelText = isRemitted ? "Remitted to Main Treasurer" : "Unremitted / Pending Process";

      groupCardsHtml += `
        <div class="card" data-cat="${esc(cat)}" style="display:flex; align-items:center; gap:12px; padding:12px 14px; margin-bottom:12px;">
          <!-- Left-side Note and Remittance Milestone Status Action Trigger -->
          <button type="button" class="mini-btn" data-action="manage-remit-status" data-cat-name="${esc(cat)}" 
                  style="width:42px; height:42px; min-height:42px; padding:0; display:flex; align-items:center; justify-content:center; font-size:16px; border-radius:50%; flex-shrink:0; background:var(--surface-alt); border:1px solid var(--hairline-strong); cursor:pointer;"
                  title="Click to manage remittance process notes and status (${statusLabelText})">
            ${statusIndicatorIcon}
          </button>
          
          <div style="flex:1; min-width:0; text-align:left;">
            <span style="font-weight:600; font-size:15px; display:block; color:var(--ink);">${esc(cat)} <small class="note">(${c.records.length} ${lbl("Year Level")})</small></span>
            <span class="note" style="font-size:12px; display:block; margin-top:2px;">
              Collected: ${peso(totalPaid)} / ${peso(totalDue)}${(tInAll || tOutAll) ? ` • Net: ${peso(netAll)}` : ''} • <i style="color:${isRemitted ? 'var(--success)' : 'var(--warning)'}; font-weight:500;">${statusLabelText}</i>
              ${remitNote ? `<br><span style="display:inline-block; font-size:11px; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); margin-top:2px;">📝 ${esc(remitNote)}</span>` : ""}
            </span>
          </div>
          <button class="del-btn" data-action="delete-cat" data-cat="${esc(cat)}" style="flex-shrink:0;">X</button>
        </div>`;
    });

    fullListHtml += `
      <div class="alpha-group" id="group-${letter}">
        <div class="alpha-header">${letter}</div>
        ${groupCardsHtml}
      </div>`;

    fullAlphaHtml += `<div data-letter="${letter}">${letter}</div>`;
  });

  // 2. INJECT ALL GENERATED MARKUP INTO THE DOM IN ONE MASSIVE COMMIT
  list.innerHTML = fullListHtml;
  alphaIndex.innerHTML = fullAlphaHtml;

  // 3. ATTACH ALL SEVEN EVENT LISTENERS ON THE FRESH AND STABLE DOM NODES

  // Card detail panel click handler
  list.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="delete-cat"]') || e.target.closest('[data-action="manage-remit-status"]')) return;
      showItems(card.dataset.cat);
    });
  });

  // Collection row deletion (X) listener handlers
  list.querySelectorAll('[data-action="delete-cat"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCat(btn.dataset.cat);
    });
  });

  // Left-side dynamic note management listener
  list.querySelectorAll('[data-action="manage-remit-status"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // Block background collection navigation triggers securely
      openCollectionRemittanceManager(btn.getAttribute('data-cat-name'));
    });
  });

  // Alphabet sidebar scroller jumping listener
  alphaIndex.querySelectorAll('div[data-letter]').forEach(div => {
    div.addEventListener('click', () => scrollToLetter(div.dataset.letter));
  });
}



function openCollectionRemittanceManager(categoryName) {
  const catObj = db.categories[categoryName];
  if (!catObj) return;

  const currentStatus = catObj.remittanceStatus || "unremitted";
  const currentNotes = catObj.remittanceNotes || "";
  
  const statusPromptText = `Remittance Processing Center: "${categoryName}"\n\n` +
    `Current Status: ${currentStatus.toUpperCase()}\n` +
    `Current Details: ${currentNotes || "None logged"}\n\n` +
    `Type 'REMITTED' to close out and mark as turned over to the Main Treasurer.\n` +
    `Type 'UNREMITTED' to keep it active inside the collection bucket logs.\n` +
    `Leave empty or type anything else to skip status updates.`;

  const statusInput = prompt(statusPromptText, currentStatus);
  if (statusInput === null) return; // User canceled execution path cleanly
  
  const cleanStatus = statusInput.trim().toLowerCase();
  if (cleanStatus === "remitted") {
    catObj.remittanceStatus = "remitted";
  } else if (cleanStatus === "unremitted") {
    catObj.remittanceStatus = "unremitted";
  }

  // Next, collect custom processing execution parameters/notes
  const notesInput = prompt(`Update descriptive notes for the collection remittance workflow process details (e.g. Voucher index codes, handover dates):`, currentNotes);
  if (notesInput !== null) {
    catObj.remittanceNotes = notesInput.trim();
  }

  // Force system states synchronization down into local storage configurations and refresh background dashboards
  saveData();
  renderCategories();
  renderCashbookSummary();
  if (typeof renderEveSummary === "function") renderEveSummary();
  
  eveAlert(`Remittance metrics updated successfully for "${categoryName}".`);
}



  function scrollToLetter(letter) {
    const element = document.getElementById(`group-${letter}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.querySelectorAll('.alpha-index div').forEach(el => el.classList.remove('active'));
      const clicked = document.querySelector(`.alpha-index div[data-letter="${letter}"]`);
      if (clicked) clicked.classList.add('active');
    }
  }

function deleteCat(cat) {
  if (confirm(`Delete collection "${cat}" and ALL its payment records? This will also automatically delete all linked transactions in the Cashbook ledger. This cannot be undone.`)) {
    
    // 1. Cascade delete linked records from the Cash Book ledger
    if (db.cashbook && Array.isArray(db.cashbook.transactions)) {
      db.cashbook.transactions = db.cashbook.transactions.filter(t => {
        // Remove if transaction category explicitly matches the deleted collection name
        const matchCategory = String(t.category).toLowerCase() === String(cat).toLowerCase();
        
        // Remove if the collection name is embedded in the auto-generated description field
        const matchDescription = t.description && t.description.includes(cat);
        
        return !(matchCategory || matchDescription);
      });
    }

    // 2. Erase any inter-collection fund transfers linked to this category
    if (Array.isArray(db.transfers)) {
      db.transfers = db.transfers.filter(t => t.from !== cat && t.to !== cat);
    }

    // 3. Delete the category itself from the database objects
    delete db.categories[cat];
    
    // 4. Commit changes down to localStorage and refresh all dashboard layouts
    saveData();
    renderCategories();
    renderCashbookSummary();
    renderCashbookList();
    renderSummary();
    
    if (typeof renderCashbookLog === "function") renderCashbookLog();
    if (typeof generateStatement === "function") generateStatement();
    
    eveAlert(`Collection "${cat}" and all its linked transactions have been permanently cleared.`);
  }
}


  // ---------- ITEM (STUDENT RECORD) VIEW ----------
  function showItems(cat) {
    currentCategory = cat;
    editingIndex = null;
    paidFilter = "all";
    closeItemFiltersMenu();
    document.getElementById("category-view").classList.add("hidden");
    document.getElementById("item-view").classList.remove("hidden");
    document.getElementById("item-view-title").innerText = cat.toUpperCase();
    const search = document.getElementById("item-search");
    if (search) search.value = "";
    const statusFilterEl = document.getElementById("item-status-filter");
    if (statusFilterEl) statusFilterEl.value = "all";
    const methodFilterEl = document.getElementById("item-method-filter");
    if (methodFilterEl) methodFilterEl.value = "all";
    const dateFilterEl = document.getElementById("item-date-filter");
    if (dateFilterEl) dateFilterEl.value = "";
    renderItemList();
  }

  function backToCategories() {
    editingIndex = null;
    closeItemFiltersMenu();
    document.getElementById("item-view").classList.add("hidden");
    document.getElementById("category-view").classList.remove("hidden");
    renderCategories();
  }

  function getAddAllStudents() {
    // Records are keyed by name, so always use the permanent database entries
    // and ignore malformed/empty legacy entries instead of aborting the action.
    return (Array.isArray(db.students) ? db.students : [])
      .filter(student => student && typeof student.name === "string" && student.name.trim())
      .map(student => ({ ...student, name: student.name.trim() }));
  }

  function getCollectionRecordNames(catObj) {
    return new Set((Array.isArray(catObj?.records) ? catObj.records : [])
      .filter(record => record && typeof record.name === "string")
      .map(record => record.name.trim().toLowerCase()));
  }

  function addAllStudents() {
    const catObj = db.categories[currentCategory];
    if (!catObj) return eveAlert("Please open a valid collection first.", true);
    if (!Array.isArray(catObj.records)) catObj.records = [];

    const allStudents = getAddAllStudents();
    if (allStudents.length === 0) {
      return eveAlert("You need to add " + lbl("year levels").toLowerCase() + " on the Student Database first, at the " + lbl("Year Level") + " tab.", true);
    }

    const existingNames = getCollectionRecordNames(catObj);
    const available = allStudents.filter(student =>
      !existingNames.has(student.name.toLowerCase())
    );

    if (available.length === 0) return eveAlert("All " + lbl("year levels").toLowerCase() + " are already in this collection.");

    document.getElementById("add-all-cat-name").innerText = currentCategory;
    addAllSelected.clear();
    document.getElementById("add-all-search").value = "";
    document.getElementById("add-all-status").innerText = "";
    renderAddAllList();
    document.getElementById("add-all-modal").classList.remove("hidden");
  }

  function closeAddAllModal() {
    document.getElementById("add-all-modal").classList.add("hidden");
    addAllSelected.clear();
  }

  function selectAllAddAll() {
    const search = (document.getElementById("add-all-search").value || "").trim().toLowerCase();
    const catObj = db.categories[currentCategory];
    const existingNames = getCollectionRecordNames(catObj);
    const visible = getAddAllStudents().filter(student =>
      !existingNames.has(student.name.toLowerCase()) &&
      student.name.toLowerCase().includes(search)
    );

    visible.forEach(student => addAllSelected.add(student.name));
    renderAddAllList();
  }

function deselectAllAddAll() {
  addAllSelected.clear();
  renderAddAllList();
}

  function renderAddAllList() {
    const search = (document.getElementById("add-all-search").value || "").trim().toLowerCase();
    const catObj = db.categories[currentCategory];
    const existingNames = getCollectionRecordNames(catObj);
    const students = getAddAllStudents();
    const available = students
      .filter(student =>
        !existingNames.has(student.name.toLowerCase()) &&
        student.name.toLowerCase().includes(search)
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    const box = document.getElementById("add-all-list");

    if (available.length === 0) {
      box.innerHTML = `<p class="note">${students.length === 0 ? 'No ' + lbl("year levels").toLowerCase() + ' in the database yet.' : 'No remaining ' + lbl("year levels").toLowerCase() + ' match your search.'}</p>`;
      return;
    }

    box.innerHTML = available.map(s => `
      <div class="add-all-item ${addAllSelected.has(s.name) ? 'selected' : ''}" data-name="${esc(s.name)}">
        <span style="font-weight:500;">${esc(s.name)}</span>
        <div class="check-indicator">${addAllSelected.has(s.name) ? '✓' : ''}</div>
      </div>
    `).join("");

    box.querySelectorAll('.add-all-item').forEach(el => {
      el.addEventListener('click', () => toggleAddAllCheckbox(el.dataset.name));
    });

    const statusEl = document.getElementById("add-all-status");
    if (addAllSelected.size > 0) {
      statusEl.innerText = `${addAllSelected.size} selected`;
      statusEl.style.color = "var(--success)";
    } else {
      statusEl.innerText = "Tap an item to select it";
      statusEl.style.color = "var(--muted)";
    }
  }

  function toggleAddAllCheckbox(name) {
    if (addAllSelected.has(name)) {
      addAllSelected.delete(name);
    } else {
      addAllSelected.add(name);
    }
    renderAddAllList();
  }

  function confirmAddAll() {
    const catObj = db.categories[currentCategory];
    if (!catObj) return eveAlert("Please open a valid collection first.", true);
    if (!Array.isArray(catObj.records)) catObj.records = [];
    if (addAllSelected.size === 0) return eveAlert("Please select at least one year level.", true);

    if (!confirm(`Add ${addAllSelected.size} ${lbl("year level").toLowerCase()}(s) to "${currentCategory}"?`)) return;

    const existingNames = getCollectionRecordNames(catObj);
    const studentsByName = new Map(getAddAllStudents().map(student => [student.name.toLowerCase(), student]));
    let added = 0;

    addAllSelected.forEach(selectedName => {
      const student = studentsByName.get(selectedName.trim().toLowerCase());
      if (!student || existingNames.has(student.name.toLowerCase())) return;

      catObj.records.push({
        name: student.name,
        due: getYearLevelTotalDue(student, catObj.amountDue),
        paid: 0,
        history: [],
        yearLevelId: student.id || null
      });
      existingNames.add(student.name.toLowerCase());
      added++;
    });

    if (added === 0) return eveAlert("The selected students could not be added.", true);
    saveData();
    closeAddAllModal();
    renderItemList();
  }

function openQuickPayModal() {
  const catObj = db.categories[currentCategory];
  if (!catObj || catObj.records.length === 0) {
    return eveAlert(`No ${lbl("year levels").toLowerCase()} in this collection yet. Add some first (or use "${lbl("Add All Year Level")}").`, true);
  }

  // FIXED: Overrides labels dynamically checking for Org Mode context bounds
  const quickPayHeader = document.querySelector("#quick-pay-modal h3");
  if (quickPayHeader) quickPayHeader.innerText = isOrg() ? "⚡ Quick Remittance Recorder" : "⚡ Quick Pay";

  const searchInput = document.getElementById("quick-pay-search");
  if (searchInput) searchInput.placeholder = isOrg() ? "Search Year Level..." : "Search student...";

  const amountLabel = document.querySelector("#quick-pay-modal label[for='quick-pay-modal-amount']");
  if (amountLabel) amountLabel.innerText = isOrg() ? "Remittance Amount per Year Level" : "Amount to Pay per Student";

  const dateLabel = document.querySelector("#quick-pay-modal label[for='quick-pay-modal-date']");
  if (dateLabel) dateLabel.innerText = isOrg() ? "Remittance Date" : "Payment Date";

  const noteLabel = document.querySelector("#quick-pay-modal label[for='quick-pay-modal-note']");
  if (noteLabel) noteLabel.innerText = isOrg() ? "Remittance Note / Details" : "Note (optional)";

  const selectAllBtn = document.querySelector("#quick-pay-modal button[onclick='selectAllQuickPay()']");
  if (selectAllBtn) selectAllBtn.innerText = isOrg() ? "Select All Year Levels" : "Select All";

  const deselectAllBtn = document.querySelector("#quick-pay-modal button[onclick='deselectAllQuickPay()']");
  if (deselectAllBtn) deselectAllBtn.innerText = isOrg() ? "Deselect All" : "Deselect All";

  const confirmBtn = document.querySelector("#quick-pay-modal button[onclick='confirmQuickPayModal()']");
  if (confirmBtn) confirmBtn.innerText = isOrg() ? "Record Batch Remittance" : "Confirm Payment";

  document.getElementById("quick-pay-noun").innerText = lbl("year levels").toLowerCase();
  document.getElementById("quick-pay-cat-label").innerText = currentCategory;
  document.getElementById("quick-pay-modal-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("quick-pay-modal-amount").value = "";
  document.getElementById("quick-pay-modal-note").value = "";
  document.getElementById("quick-pay-search").value = "";
  document.getElementById("quick-pay-status").innerText = "";
  
  quickPaySelected.clear();
  renderQuickPayList();
  document.getElementById("quick-pay-modal").classList.remove("hidden");
}


function closeQuickPayModal() {
  document.getElementById("quick-pay-modal").classList.add("hidden");
  quickPaySelected.clear();
}

function selectAllQuickPay() {
  const search = (document.getElementById("quick-pay-search").value || "").toLowerCase();
  const catObj = db.categories[currentCategory];
  if (!catObj) return;
  catObj.records
    .filter(r => r.name.toLowerCase().includes(search) && matchesQuickPayYear(r))
    .forEach(r => quickPaySelected.add(r.name));
  renderQuickPayList();
}

function deselectAllQuickPay() {
  quickPaySelected.clear();
  renderQuickPayList();
}

function renderQuickPayList() {
  const search = (document.getElementById("quick-pay-search").value || "").toLowerCase();
  const catObj = db.categories[currentCategory];
  const box = document.getElementById("quick-pay-list");
  if (!catObj || !box) return;

  const matches = catObj.records
    .filter(r => r.name.toLowerCase().includes(search) && matchesQuickPayYear(r))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (matches.length === 0) {
    box.innerHTML = `<p class="note">No matching ${lbl("year level").toLowerCase()}.</p>`;
    return;
  }

  box.innerHTML = matches.map(r => {
    const balance = round2(r.due - r.paid);
    // FIXED: Formats inner balance tracking metrics cleanly checking workspace context state variables
    const balanceDescriptor = isOrg() ? "Remittance Balance" : "Balance";
    return `
      <div class="add-all-item ${quickPaySelected.has(r.name) ? 'selected' : ''}" data-name="${esc(r.name)}">
        <span style="font-weight:500;">${esc(r.name)}<br><span class="note">${balanceDescriptor}: ${peso(balance)}</span></span>
        <div class="check-indicator">${quickPaySelected.has(r.name) ? '✓' : ''}</div>
      </div>
    `;
  }).join("");

  box.querySelectorAll('.add-all-item').forEach(el => {
    el.addEventListener('click', () => toggleQuickPayCheckbox(el.dataset.name));
  });

  const statusEl = document.getElementById("quick-pay-status");
  if (quickPaySelected.size > 0) {
    statusEl.innerText = `${quickPaySelected.size} selected`;
    statusEl.style.color = "var(--success)";
  } else {
    statusEl.innerText = `Tap a ${lbl("year level").toLowerCase()} to select it`;
    statusEl.style.color = "var(--muted)";
  }
}

function toggleQuickPayCheckbox(name) {
  if (quickPaySelected.has(name)) quickPaySelected.delete(name);
  else quickPaySelected.add(name);
  renderQuickPayList();
}

function confirmQuickPayModal() {
  const catObj = db.categories[currentCategory];
  if (!catObj) return;

  if (quickPaySelected.size === 0) {
    return eveAlert(`Please select at least one ${lbl("year level").toLowerCase()}.`, true);
  }

  const amount = round2(parseFloat(document.getElementById("quick-pay-modal-amount").value) || 0);
  if (amount <= 0) return eveAlert("Please enter a valid amount.", true);

  const dateVal = document.getElementById("quick-pay-modal-date").value || new Date().toISOString().slice(0, 10);
  const note = document.getElementById("quick-pay-modal-note").value.trim();

  // FIXED: Dynamic structural text mapping constraints for absolute runtime tracking verification prompts
  const trackingActionPromptText = isOrg() 
    ? `Record a remittance entry of ${peso(amount)} for ${quickPaySelected.size} year level(s) inside "${currentCategory}"?`
    : `Record a payment of ${peso(amount)} for ${quickPaySelected.size} student(s) in "${currentCategory}"?`;

  if (!confirm(trackingActionPromptText)) return;

  let recorded = 0;
  quickPaySelected.forEach(name => {
    const rec = catObj.records.find(r => r.name === name);
    if (!rec) return;

    const transactionId = "TX-QP-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);

    rec.paid = round2(rec.paid + amount);
    rec.history.push({ id: transactionId, amount, date: dateVal, note: note || "Quick Remittance" });
    recorded++;

    if (isOrg()) {
      // FIXED: Ensures batch quick records map safely down stream into the Cash Book as standard remittances
      db.cashbook.transactions.push({
        id: transactionId,
        type: "remittance",
        date: dateVal,
        orNumber: "",
        category: "Year-Level Remittance",
        description: `Remittance from ${name} — ${currentCategory}`,
        amount,
        projectId: null,
        notes: note || "Batch Quick Remittance"
      });
    } else {
      db.cashbook.transactions.push({ id: transactionId, type: "income", date: dateVal, orNumber: "", category: "Year Levels Payment", description: `Payment from ${name} — ${currentCategory}`, amount, projectId: null, notes: note || "" });
    }
  });

  saveData();
  closeQuickPayModal();
  renderItemList();
  
  // Refresh companion modules instantly to prevent visual updates delay blocks
  renderCategories();
  renderCashbookSummary();
  renderCashbookList();
  renderSummary();
  if (typeof renderCashbookLog === "function") renderCashbookLog();

  const successMessagePrompt = isOrg()
    ? `Recorded ${peso(amount)} remittance for ${recorded} year level(s) inside database.`
    : `Recorded ${peso(amount)} payment for ${recorded} student(s).`;

  eveAlert(successMessagePrompt);
}


  async function exportCategoryCSV() {
    const catObj = db.categories[currentCategory];
    if (!catObj || catObj.records.length === 0) return eveAlert("No records to export yet.");

    let csv = "Name,Due,Paid,Balance,Status\r\n";
    [...catObj.records].sort((a, b) => a.name.localeCompare(b.name)).forEach(r => {
      const balance = round2(r.due - r.paid);
      const status = balance < 0 ? "OVERPAID" : balance === 0 ? "PAID" : r.paid > 0 ? "PARTIAL" : "UNPAID";
      // Escape quotes in names for proper CSV
        const safeName = r.name.replace(/"/g, '""');
        csv += `"${safeName}",${r.due.toFixed(2)},${r.paid.toFixed(2)},${balance.toFixed(2)},${status}\r\n`;
    });

    const cleanFileName = `${currentCategory.replace(/[^a-z0-9]/gi, "_")}-report.csv`;
    await exportFileCrossPlatform(csv, cleanFileName, "text/csv", `Export ${currentCategory} Report`);
  }

  async function exportBackup() {
    const jsonStr = JSON.stringify(db, null, 2);
    const fileName = `treasurer-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const success = await exportFileCrossPlatform(jsonStr, fileName, "application/json", "Export Backup");
    if (success) {
      localStorage.setItem("lastBackupTime", String(Date.now()));
      renderSummary();
    }
  }

  // Shared export helper: works both in a regular PC browser (dev/testing)
  // and inside the built Android app (via Filesystem + Share plugins).
  // Returns true if the export completed without error.
  async function exportFileCrossPlatform(content, fileName, mimeType, shareTitle) {
    if (!isAndroidApp()) {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      return true;
    }

    try {
      const plugins = window.Capacitor.Plugins || {};
      const { Filesystem, Share } = plugins;

      if (!Filesystem || !Share) {
        eveAlert(
          "Export needs the Filesystem and Share plugins, but they aren't installed in this build." +
  "Make sure @capacitor/filesystem and @capacitor/share are installed and synced before building the APK."
        , true);
        return false;
      }

      const writeResult = await Filesystem.writeFile({
        path: fileName,
        data: content,
        directory: "CACHE",
        encoding: "utf8"
      });

      await Share.share({
        title: shareTitle,
        url: writeResult.uri,
        dialogTitle: "Save File"
      });
      return true;
    } catch (e) {
      eveAlert("Mobile Export Error: " + e.message, true);
      return false;
    }
  }

function renderItemList() {
  const catObj = db.categories[currentCategory];
  const box = document.getElementById("item-list");
  const searchTerm = (document.getElementById("item-search")?.value || "").toLowerCase();
  const itemMethodFilter = document.getElementById("item-method-filter")?.value || "all";
  const itemDateFilter = document.getElementById("item-date-filter")?.value || "";

  const totalDue = catObj.records.reduce((s, r) => s + r.due, 0);
  const totalPaid = catObj.records.reduce((s, r) => s + r.paid, 0);
  const totalBalance = round2(totalDue - totalPaid);
  const paidStudents = catObj.records.filter(r => r.paid >= r.due && r.due > 0).length;
  const partialStudents = catObj.records.filter(r => r.paid > 0 && r.paid < r.due).length;
  const unpaidStudents = catObj.records.filter(r => r.paid <= 0).length;

const tOut = (db.transfers||[]).filter(t => t.from === currentCategory).reduce((s,t)=>s+t.amount,0);
const tIn  = (db.transfers||[]).filter(t => t.to   === currentCategory).reduce((s,t)=>s+t.amount,0);
const netCollected = round2(totalPaid + tIn - tOut);

document.getElementById("item-summary").innerHTML = `
    Collected <b>${peso(totalPaid)}</b> &nbsp;|&nbsp;
    Expected <b>${peso(totalDue)}</b> &nbsp;|&nbsp;
    Balance <b style="color:${totalBalance > 0 ? '#B3423B' : '#2F7D53'}">${peso(totalBalance)}</b>
  <br><span class="collection-status-line"><span class="status-paid">PAID: ${paidStudents}</span><span class="status-partial">PARTIALLY PAID: ${partialStudents}</span><span class="status-unpaid">UNPAID: ${unpaidStudents}</span></span>
    ${(tIn||tOut) ? `<br><span class="note">Net after transfers: <b>${peso(netCollected)}</b> (In ${peso(tIn)} / Out ${peso(tOut)})</span>` : ''}
  `;

if (catObj.records.length === 0) {
    box.innerHTML = `<p class="note">No ${lbl("year level").toLowerCase()} added to this collection yet. Use "${lbl("Add All Year Level")}" above to get started.</p>`;
  }
  /* ── TRANSFER TRANSACTION LOGS ──
     Every fund movement between collections is permanently logged here
     with date, direction (From → To), amount, and optional note.        */
  const txfers = (db.transfers||[]).filter(t => t.from === currentCategory || t.to === currentCategory).sort((a,b)=>a.date.localeCompare(b.date));
  if (txfers.length) {
   const txferHtml = txfers.map(t => {
      const isOutgoing = t.from === currentCategory;
      const directionLabel = isOutgoing ? 'Sent to' : 'Received from';
      const otherParty = isOutgoing ? t.to : t.from;
      const sign = isOutgoing ? '−' : '+';
      const color = isOutgoing ? 'var(--danger)' : 'var(--success)';
      return `
        <div class="history-entry" style="padding:10px 0; border-bottom:1px solid rgba(233,240,235,0.08);">
          <div style="display:flex; flex-direction:column; gap:2px;">
            <span style="font-weight:600; color:#E9F0EB;">${esc(directionLabel)} <b>${esc(otherParty)}</b></span>
            <span class="note">${esc(t.date)}${t.note ? ' • ' + esc(t.note) : ''}</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px; margin-left:12px;">
            <span style="color:${color}; font-weight:700; font-family:'IBM Plex Mono',monospace; white-space:nowrap;">
              ${sign}${peso(t.amount)}
            </span>
            <button class="mini-btn mini-delete" data-action="delete-transfer" data-id="${esc(t.id)}">DEL</button>
          </div>
        </div>`;
    }).join('');

    box.innerHTML += `
      <div style="margin-top:22px; background:linear-gradient(135deg, #141c18, #1a2420); border:1px solid rgba(233,240,235,0.10); border-radius:var(--radius); padding:16px 18px; box-shadow:0 2px 8px rgba(0,0,0,0.35);">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; padding-bottom:10px; border-bottom:1.5px dashed rgba(233,240,235,0.10);">
          <span style="font-size:16px;">⇄</span>
          <h4 style="margin:0; padding:0; font-size:14px; color:#E9F0EB;">Transfer Transaction Logs</h4>
          <span class="note" style="margin-left:auto; font-size:11px;">${txfers.length} record(s)</span>
        </div>
        ${txferHtml}
      </div>`;
  }
  if (catObj.records.length === 0) return;

  const sorted = [...catObj.records]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(r => r.name.toLowerCase().includes(searchTerm))
    .filter(r => {
      if (paidFilter === "paid") return r.paid >= r.due && r.due > 0;
      if (paidFilter === "partial") return r.paid > 0 && r.paid < r.due;
      if (paidFilter === "unpaid") return r.paid <= 0;
      return true;
    })
    .filter(r => {
      if (itemMethodFilter === "all") return true;
      return Array.isArray(r.history) && r.history.some(h => (h.method || "cash") === itemMethodFilter);
    })
    .filter(r => {
      if (!itemDateFilter) return true;
      return Array.isArray(r.history) && r.history.some(h => h.date === itemDateFilter);
    });

  if (sorted.length === 0) {
    box.innerHTML = `<p class="note">No matching student.</p>`;
    return;
  }

  box.innerHTML = sorted.map(rec => {
    const idx = catObj.records.indexOf(rec);
    const yearLevel = isOrg() ? db.students.find(student => student.name === rec.name) : null;
    const balance = round2(rec.due - rec.paid);
    
    let statusLabel, statusColor, statusBadgeBg;
    if (balance < 0) { 
      statusLabel = "OVERPAID"; 
      statusColor = "#3B6E8F"; 
      statusBadgeBg = "rgba(59, 110, 143, 0.12)";
    } else if (balance === 0) { 
      statusLabel = "PAID"; 
      statusColor = "#2F7D53"; 
      statusBadgeBg = "rgba(47, 125, 83, 0.12)";
    } else if (rec.paid > 0) { 
      statusLabel = "PARTIAL"; 
      statusColor = "#B8872F"; 
      statusBadgeBg = "rgba(184, 135, 47, 0.12)";
    } else { 
      statusLabel = "UNPAID"; 
      statusColor = "#B3423B"; 
      statusBadgeBg = "rgba(179, 66, 59, 0.12)";
    }

    // Safely pull database properties out here to prevent nested string breaks
    const studentCountInt = yearLevel ? getYearLevelStudentCount(yearLevel) : 0;

    return `
      <!-- Main Row Container with absolute clearances enabled -->
      <div class="item-row" data-action="edit-item" data-idx="${idx}" style="display: flex !important; justify-content: space-between !important; align-items: center !important; padding: 16px !important; margin-bottom: 16px !important; border: 1px solid var(--hairline) !important; border-radius: var(--radius) !important; background: var(--surface) !important; box-shadow: var(--shadow-sm) !important; transition: all 0.2s ease !important; cursor: pointer !important; position: relative !important; overflow: visible !important; z-index: 5 !important; width: 100% !important; box-sizing: border-box !important;">
        
        <!-- Left Column: Title and Floating Button Trigger -->
        <div style="flex: 1 !important; min-width: 0 !important; display: flex !important; flex-direction: column !important; gap: 8px !important; text-align: left !important; position: relative !important; overflow: visible !important; z-index: 10 !important;">
          <span style="font-size: 19px !important; font-weight: 700 !important; color: var(--ink) !important; display: block !important; margin: 0 !important;">${esc(rec.name)}</span>
          
          <!-- Compact Button toggles visibility using pure inline layout rules -->
          <button type="button" onclick="event.stopPropagation(); const pop = this.nextElementSibling; const row = this.closest('.item-row'); document.querySelectorAll('.item-row').forEach(r => { if(r !== row) { r.style.setProperty('z-index', '5', 'important'); r.querySelector('.floating-status-popover').style.setProperty('display', 'none', 'important'); } }); if(pop.style.display === 'none') { row.style.setProperty('z-index', '9999', 'important'); pop.style.setProperty('display', 'flex', 'important'); } else { row.style.setProperty('z-index', '5', 'important'); pop.style.setProperty('display', 'none', 'important'); }" style="width: auto !important; max-width: max-content !important; padding: 6px 14px !important; font-size: 12px !important; font-weight: 600 !important; color: var(--accent) !important; background: var(--surface-alt) !important; border: 1px solid var(--hairline-strong) !important; border-radius: 6px !important; cursor: pointer !important; display: inline-flex !important; align-items: center !important; gap: 4px !important; box-shadow: var(--shadow-sm) !important; height: auto !important; line-height: 1.2 !important; user-select: none !important;">
            Show Status
          </button>

          <!-- ── FLOATING POPOVER LAYER: Buttons completely removed ── -->
          <div class="floating-status-popover" onclick="event.stopPropagation();" style="display: none !important; position: absolute !important; top: calc(100% + 6px) !important; left: 0px !important; background: var(--surface, #ffffff) !important; width: 250px !important; border: 1px solid var(--hairline-strong, rgba(0,0,0,0.2)) !important; border-radius: var(--radius-sm, 8px) !important; z-index: 999999 !important; box-shadow: 0 10px 30px rgba(0,0,0,0.25) !important; padding: 14px !important; box-sizing: border-box !important; flex-direction: column !important; gap: 12px !important; text-align: left !important;">
            
            <!-- Grid Layout labels layout context -->
            <div style="display: grid !important; grid-template-columns: auto 1fr !important; gap: 6px 14px !important; font-size: 13px !important; color: var(--muted) !important; line-height: 1.4 !important;">
              <span style="font-weight: 500 !important; color: var(--muted) !important;">Paid:</span>
              <span style="font-family: 'IBM Plex Mono', monospace !important; font-weight: 600 !important; color: var(--success) !important;">${peso(rec.paid)}</span>
              
              <span style="font-weight: 500 !important; color: var(--muted) !important;">Due:</span>
              <span style="font-family: 'IBM Plex Mono', monospace !important; font-weight: 600 !important; color: var(--ink) !important;">${peso(rec.due)}</span>
              
              <span style="font-weight: 500 !important; color: var(--muted) !important;">Balance:</span>
              <span style="font-family: 'IBM Plex Mono', monospace !important; font-weight: 600 !important; color: ${balance > 0 ? 'var(--danger)' : 'var(--success)'} !important;">${peso(balance)}</span>
              
              ${yearLevel ? `
                <span style="font-weight: 500 !important; color: var(--muted) !important;">Students:</span>
                <span style="font-weight: 600 !important; color: var(--ink) !important;">${studentCountInt} enrolled</span>
              ` : ''}
            </div>
          </div>
        </div>
        
        <!-- Right Column: Permanent Numeric Balance face Indicator Badge & Delete Cross Trigger -->
        <div style="display: flex !important; align-items: center !important; gap: 14px !important; flex-shrink: 0 !important; text-align: right !important; margin-left: 12px !important; z-index: 10 !important;">
          <div style="display: flex !important; flex-direction: column !important; align-items: flex-end !important; gap: 2px !important;">
            <span style="font-size: 17px !important; font-weight: 700 !important; font-family: 'IBM Plex Mono', monospace !important; color: ${statusColor} !important; line-height: 1.1 !important;">${peso(balance)}</span>
            <span class="record-status-label" style="font-size: 9px !important; font-weight: 700 !important; padding: 2px 6px !important; border-radius: 4px !important; color: ${statusColor} !important; background: ${statusBadgeBg} !important; text-transform: uppercase !important; letter-spacing: 0.5px !important; display: inline-block !important; line-height: 1 !important;">${statusLabel}</span>
          </div>
          
          <button type="button" class="row-x-btn" data-action="delete-item" data-idx="${idx}" title="Remove from collection" style="width: 32px !important; height: 32px !important; min-height: 32px !important; border-radius: 50% !important; background: transparent !important; color: var(--danger) !important; border: 1.5px solid var(--danger) !important; font-size: 13px !important; font-weight: 700 !important; display: flex !important; align-items: center !important; justify-content: center !important; cursor: pointer !important; box-shadow: none !important; padding: 0 !important; transition: all 0.2s ease !important;">✕</button>
        </div>

      </div>`;
  }).join("");




/* ── SINGLE CONTAINER CLICK HANDLER ── */
/* ── FIXED SINGLE CONTAINER CLICK HANDLER ── */
box.onclick = function (e) {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return; 

  const action = actionEl.dataset.action;
  e.stopPropagation();

  if (action === 'cancel-edit') {
    cancelEdit();
    return;
  }

  if (action === 'delete-transfer') {
    deleteTransfer(actionEl.dataset.id);
    return;
  }

  // FIXED: If row is tapped and we aren't clicking an explicit form button, trigger edit
  if (action === 'edit-item' && !e.target.closest('button') && !e.target.closest('input')) {
    openCollectionEdit(parseInt(actionEl.dataset.idx, 10));
    return;
  }

  const idx = parseInt(actionEl.dataset.idx || actionEl.dataset.rec, 10);
  if (isNaN(idx)) return;

  const histIdx = parseInt(actionEl.dataset.hist, 10);

  switch (action) {
    case 'quick-pay':
      quickPay(idx);
      break;
    case 'save-edit':
      saveItemEdit(idx);
      break;
    case 'delete-item':
      deleteItem(idx);
      break;
    case 'edit-hist':
      openEditHistoryModal(idx, histIdx);
      break;
    case 'del-hist':
      deleteHistoryEntry(idx, histIdx);
      break;
  }
};

  }

function setPaidFilter(filter) {
  paidFilter = filter;
  renderItemList();
}

  function editItem(index) {
    openCollectionEdit(index);
  }

function openCollectionEdit(index) {
  const record = db.categories[currentCategory]?.records[index];
  if (!record) return;
  editingIndex = index;
  
  document.getElementById("collection-edit-student-name").innerText = record.name;
  const editStudent = isOrg() ? db.students.find(student => student.name === record.name) : null;
  const studentCount = editStudent ? Math.max(1, getYearLevelStudentCount(editStudent)) : 1;
  
  const dueLabel = document.getElementById("collection-edit-due-label");
  const dueInput = document.getElementById("collection-edit-due");
  const rosterBox = document.getElementById("collection-edit-roster-box");
  
  const orgEditing = isOrg();
  if (dueLabel) dueLabel.innerText = orgEditing ? "Amount per Student" : "Amount Due";
  if (dueInput) {
    dueInput.placeholder = orgEditing ? "Amount per Student" : "Amount Due";
    dueInput.value = orgEditing ? round2(record.due / studentCount) : record.due;
  }
  if (rosterBox) rosterBox.classList.toggle("hidden", !orgEditing);
  
  // ─── ADDED: CRITICAL TRANSACTION CONFLICT WARNING ───
  // Looks for an existing warning block or creates a new one to prevent duplication
  let warningEl = document.getElementById("collection-edit-conflict-warning");
  if (!warningEl) {
    warningEl = document.createElement("div");
    warningEl.id = "collection-edit-conflict-warning";
    warningEl.style.cssText = "background: rgba(179, 66, 59, 0.08); border: 1.5px dashed var(--danger, #b3423b); border-radius: 8px; padding: 12px; margin-bottom: 16px; color: var(--danger, #b3423b); font-size: 13px; font-weight: 500; line-height: 1.4; text-align: left;";
    
    // Injects it smoothly right at the top of the content area below the header name
    const nameHeader = document.getElementById("collection-edit-student-name");
    if (nameHeader && nameHeader.parentNode) {
      nameHeader.parentNode.insertBefore(warningEl, nameHeader.nextSibling);
    }
  }
  warningEl.innerHTML = "⚠️ <b>Important Note:</b> Do not change the amount due and record a payment at the same time, for it will cause an overpaid calculation error.";
  // ───────────────────────────────────────────────────

  // ── ORG MODE TERMINOLOGY RE-LABELLING OVERRIDES ──
  const addPaymentHeader = document.getElementById("collection-edit-pay-label") || 
                           document.querySelector("#collection-edit-modal label[for='collection-edit-pay']") ||
                           document.querySelector("#collection-edit-modal .form-box h4") ||
                           Array.from(document.querySelectorAll("#collection-edit-modal h4, #collection-edit-modal p")).find(el => el.innerText.includes("Add Payment"));
  if (addPaymentHeader) {
    addPaymentHeader.innerText = orgEditing ? "Add Remittance" : "Add Payment";
  }

  const amountInput = document.getElementById("collection-edit-pay");
  if (amountInput) {
    amountInput.placeholder = orgEditing ? "Remittance amount" : "Payment amount";
  }

  const noteInput = document.getElementById("collection-edit-note");
  if (noteInput) {
    noteInput.placeholder = orgEditing ? "Remittance note (optional)" : "Payment note (optional)";
  }

  const submitBtn = document.getElementById("collection-quick-pay-btn") || 
                    document.querySelector("#collection-edit-modal button[onclick='collectionQuickPay()']") ||
                    Array.from(document.querySelectorAll("#collection-edit-modal button")).find(el => el.innerText.includes("Add Payment"));
  if (submitBtn) {
    submitBtn.innerText = orgEditing ? "Add Remittance" : "Add Payment";
  }

  const historyHeader = document.getElementById("collection-history-header") || 
                        document.querySelector("#collection-edit-history")?.previousElementSibling;
  if (historyHeader) {
    historyHeader.innerHTML = orgEditing ? "<b>Remittance History</b>" : "<b>Payment History</b>";
  }

  const payDate = document.getElementById("collection-edit-date");
  const payAmount = document.getElementById("collection-edit-pay");
  const payNote = document.getElementById("collection-edit-note");
  
  if (payDate) payDate.value = new Date().toISOString().slice(0, 10);
  if (payAmount) payAmount.value = "";
  if (payNote) payNote.value = "";
  setCollectionEditMethod("cash");
  
  record.studentLedger = Array.isArray(record.studentLedger) ? record.studentLedger : [];
  renderCollectionEditHistory(record);
  document.getElementById("collection-edit-modal").classList.remove("hidden");
  updateRecordRosterIndicator();
}



function setCollectionEditMethod(method) {
  collectionEditMethod = method;
  document.querySelectorAll('#collection-edit-method-toggle .method-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.method === method);
  });
}

function renderCollectionEditHistory(record) {
  const box = document.getElementById("collection-edit-history");
  if (!box) return;
  
  box.innerHTML = record.history.length
    ? record.history.slice().reverse().map((entry, reverseIndex) => {
        const index = record.history.length - 1 - reverseIndex;
        
        // ─── CHECK IF MONEY IS IN (+) OR OUT (-) ───
        const isMoneyOut = entry.amount < 0;
        const transactionSign = isMoneyOut ? "−" : "+";
        const transactionColor = isMoneyOut ? "#B3423B" : "#2F7D53"; // Red for Out, Green for In
        
        // Format the absolute amount value so we don't duplicate negative symbols on display
        const displayAmount = peso(Math.abs(entry.amount));

        return `
          <div class="history-entry" style="display: flex !important; justify-content: space-between !important; align-items: center !important; padding: 12px 14px !important; border-bottom: 1px solid var(--hairline, rgba(0,0,0,0.06)) !important; font-size: 13.5px !important; background: var(--surface, #ffffff) !important; box-sizing: border-box !important; width: 100% !important;">
            
            <!-- Left Info Stack: Amount and Subtext metadata details context -->
            <div style="display: flex !important; flex-direction: column !important; gap: 3px !important; text-align: left !important; flex: 1 !important; min-width: 0 !important;">
              
              <!-- Color Coded Amount with In/Out Indicator Sign Symbol -->
              <span style="color: ${transactionColor} !important; font-weight: 700 !important; font-family: 'IBM Plex Mono', monospace, sans-serif !important; display: flex !important; align-items: center !important; gap: 3px !important;">
                <span>${transactionSign}</span> ${displayAmount}
              </span>
              
              <span style="font-size: 11.5px !important; color: var(--muted, #666666) !important; line-height: 1.3 !important;">
                📆 ${esc(entry.date)} • ${(entry.method || "cash") === "gcash" ? "📱 GCash" : "💵 Cash"} ${entry.note ? '• ' + esc(entry.note) : ''}
              </span>
            </div>
            
            <!-- Aligned Delete Action Controller Box -->
            <button type="button" class="mini-btn mini-delete" onclick="event.stopPropagation(); deleteCollectionEditHistory(${index})" style="padding: 5px 12px !important; color: #b3423b !important; background: rgba(179, 66, 59, 0.06) !important; border: 1px solid rgba(179, 66, 59, 0.25) !important; border-radius: 4px !important; font-size: 11px !important; font-weight: 700 !important; cursor: pointer !important; flex-shrink: 0 !important; margin-left: 8px !important;">DEL</button>
          </div>`;
      }).join("")
    : `<div style="padding: 16px !important; font-size: 13px !important; color: var(--muted, #666666) !important; text-align: center !important; background: var(--surface, #ffffff) !important; width: 100% !important; box-sizing: border-box !important;">No payments logged yet.</div>`;
}



function closeCollectionEdit() {
  document.getElementById("collection-edit-modal").classList.add("hidden");
  editingIndex = null;
}


// 🌟 GLOBAL STATE LOCK (Put this at the very top of your JS script file)
if (typeof window.isProcessingPayment === "undefined") {
  window.isProcessingPayment = false;
}

function collectionQuickPay(event) {
  // 🌟 FIX 1: Prevent standard HTML form/button submission bubble behaviors
  if (event && typeof event.preventDefault === "function") {
    event.preventDefault();
  }

  // 🌟 FIX 2: Check if a payment is currently running. If true, block this duplicate run!
  if (window.isProcessingPayment) return;

  const record = db.categories[currentCategory]?.records[editingIndex];
  if (!record) return;
  
  const amountInput = document.getElementById("collection-edit-pay");
  const amount = round2(parseFloat(amountInput.value) || 0);
  
  // Exit immediately if there's no money entered
  if (amount <= 0) return eveAlert("Please enter a valid payment amount.", true);
  
  // 🌟 FIX 3: Activate the interaction lock immediately upon valid amount confirmation
  window.isProcessingPayment = true;

  const date = document.getElementById("collection-edit-date").value || new Date().toISOString().slice(0, 10);
  const noteInput = document.getElementById("collection-edit-note");
  const note = noteInput.value.trim();
  
  const transactionId = "TX-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  
  record.paid = round2(record.paid + amount);
  if (!Array.isArray(record.history)) record.history = [];
  record.history.push({ 
    id: transactionId,
    amount, 
    date, 
    note: note || "Collection Remittance Entry",
    method: collectionEditMethod || "cash"
  });
  
  if (isOrg()) {
    db.cashbook.transactions.push({
      id: transactionId,
      type: "remittance",              
      date,
      orNumber: "",
      category: "Year-Level Remittance", 
      description: `Remittance from ${record.name} — ${currentCategory}`, 
      amount,
      projectId: null,
      notes: note
    });
  } else {
    db.cashbook.transactions.push({ id: transactionId, type: "income", date, orNumber: "", category: "Year Levels Payment", description: `Payment from ${record.name} — ${currentCategory}`, amount, projectId: null, notes: note });
  }
  
  saveData();
  
  // Reset fields to ensure background workers don't scrape it again
  amountInput.value = "0";
  if (noteInput) noteInput.value = "";
  setCollectionEditMethod("cash");
  
  renderCollectionEditHistory(record);
  renderItemList();
  renderCategories();
  renderCashbookSummary();
  renderCashbookList();
  renderSummary(); 
  if (typeof renderCashbookLog === "function") renderCashbookLog();
  
  eveAlert(`Remittance of ${peso(amount)} from ${record.name} saved successfully.`);

  // 🌟 FIX 4: Clear the processing lock after a brief cooling-off period (1.5 seconds)
  setTimeout(() => {
    window.isProcessingPayment = false;
  }, 1500);
}

function saveCollectionEdit(event) {
  // Prevent any form triggers or event bubbles
  if (event && typeof event.preventDefault === "function") {
    event.preventDefault();
  }

  const record = db.categories[currentCategory]?.records[editingIndex];
  if (!record) return;
  
  // Read strictly from the "Amount Due" field
  const enteredAmount = round2(parseFloat(document.getElementById("collection-edit-due").value) || 0);
  if (enteredAmount < 0) return eveAlert(isOrg() ? "Amount per student cannot be negative." : "Amount Due cannot be negative.", true);
  
  // Process structural targets only
  if (isOrg()) {
    const yearLevel = db.students.find(student => student.name === record.name);
    const studentCount = Math.max(1, getYearLevelStudentCount(yearLevel));
    if (yearLevel) yearLevel.perStudentAmount = enteredAmount;
    record.due = round2(enteredAmount * studentCount);
  } else {
    record.due = enteredAmount;
  }
  
  saveData();
  
  // Refresh layout layout elements
  renderItemList();
  renderCategories();
  renderSummary();
  refreshEveSummaryIfVisible();
  
  eveAlert("Amount Due updated successfully!");
}





function deleteCollectionEditHistory(index) {
  const record = db.categories[currentCategory]?.records[editingIndex];
  if (!record || !record.history || !record.history[index]) return;
  
  if (!confirm("Permanently delete this remittance record? This will automatically wipe its corresponding log from the Cashbook ledger and update all system metrics.")) return;
  
  const targetPayment = record.history[index];
  const targetId = targetPayment.id;
  
  // ── CASCADE DELETION ENGINE WRAPPER ──
  if (db.cashbook && Array.isArray(db.cashbook.transactions)) {
    let initialLength = db.cashbook.transactions.length;
    
    if (targetId) {
      // Step A: Primary check using strict unique tracking IDs
      db.cashbook.transactions = db.cashbook.transactions.filter(t => String(t.id) !== String(targetId));
    }
    
    // Step B: Multi-criteria backup fallback check to capture older system entries
    if (db.cashbook.transactions.length === initialLength) {
      db.cashbook.transactions = db.cashbook.transactions.filter(t => {
        const dateMatch = (t.date === targetPayment.date);
        const amountMatch = (round2(t.amount) === round2(targetPayment.amount));
        const typeMatch = (t.type === "remittance" || t.type === "income");
        
        // Verifies the description contains the year level name to prevent false matches
        const descMatch = t.description && t.description.includes(record.name);
        
        return !(dateMatch && amountMatch && typeMatch && descMatch);
      });
    }
  }
  
  // ── UPDATE LOCAL OBJECT DATA STATES ──
  record.history.splice(index, 1);
  record.paid = round2(record.history.reduce((sum, entry) => sum + entry.amount, 0));
  
  saveData();
  
  // ── RE-RENDER WORKSPACE INTERFACES IMMEDIATELY ──
  renderCollectionEditHistory(record);
  renderItemList();
  renderCategories();
  renderCashbookSummary();
  renderCashbookList();
  
  // ── REBUILD EVE'S SMART PANELS LIVE ──
  renderSummary(); // Refreshes native summary views
  if (typeof renderEveSummary === "function") {
    renderEveSummary(); // Forces EVE's custom summary overlay metric cards to update instantly
  }
  if (typeof renderCashbookLog === "function") {
    renderCashbookLog(); // Re-syncs the tracking log entries
  }
  
  eveAlert("Remittance deleted cleanly. Cashbook ledger and EVE's summary overview updated successfully.");
}



  function cancelEdit() {
    editingIndex = null;
    renderItemList();
  }

  function quickPay(idx) {
    const val = round2(parseFloat(document.getElementById(`quick-pay-${idx}`).value));
    if (!val || val <= 0) return eveAlert("Enter a valid payment amount", true);
    const rec = db.categories[currentCategory].records[idx];
    const dateVal = document.getElementById(`quick-pay-date-${idx}`).value;
    const noteVal = document.getElementById(`quick-pay-note-${idx}`).value.trim();
    rec.paid = round2(rec.paid + val);
    rec.history.push({ amount: val, date: dateVal || new Date().toISOString().slice(0, 10), note: noteVal });

    // Also log this payment in the Cash Book so the ledger stays in sync
    db.cashbook.transactions.push({
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      type: "income",
      date: new Date().toISOString().slice(0, 10),
      orNumber: "",
      category: "Year Levels Payment",
      description: `Payment from ${rec.name} — ${currentCategory}`,
      amount: val,
      projectId: null,
      notes: ""
    });

    saveData();
    renderItemList();
  }

function saveItemEdit(idx) {
    const due = round2(parseFloat(document.getElementById(`edit-due-${idx}`).value) || 0);
    const paid = round2(parseFloat(document.getElementById(`edit-paid-${idx}`).value) || 0);
    if (due < 0 || paid < 0) return eveAlert("Values cannot be negative", true);
    const rec = db.categories[currentCategory].records[idx];
    rec.due = due;
    rec.paid = paid;
    editingIndex = null;
    saveData();
    renderItemList();
  }

  function openEditHistoryModal(recIdx, histIdx) {
    const rec = db.categories[currentCategory].records[recIdx];
    const entry = rec.history[histIdx];
    let dateVal = entry.date || "";
    if (dateVal && !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
      const d = new Date(dateVal);
      if (!isNaN(d.getTime())) dateVal = d.toISOString().slice(0, 10);
    }
    document.getElementById("edit-hist-date").value = dateVal || new Date().toISOString().slice(0, 10);
    document.getElementById("edit-hist-amount").value = entry.amount;
    document.getElementById("edit-hist-note").value = entry.note || "";
    editingHistory = { recIdx, histIdx };
    document.getElementById("edit-history-modal").classList.remove("hidden");
  }

  function closeEditHistoryModal() {
    document.getElementById("edit-history-modal").classList.add("hidden");
    editingHistory = { recIdx: null, histIdx: null };
  }

  function confirmEditHistory() {
    const { recIdx, histIdx } = editingHistory;
    if (recIdx === null) return;
    const rec = db.categories[currentCategory].records[recIdx];
    const entry = rec.history[histIdx];
    const newDate = document.getElementById("edit-hist-date").value;
    const newAmount = round2(parseFloat(document.getElementById("edit-hist-amount").value) || 0);
    const newNote = document.getElementById("edit-hist-note").value.trim();
    if (newAmount <= 0) return eveAlert("Please enter a valid amount.", true);
    rec.paid = round2(rec.paid - entry.amount + newAmount);
    if (rec.paid < 0) rec.paid = 0;
    entry.amount = newAmount;
    entry.date = newDate || entry.date;
    entry.note = newNote;
    saveData();
    closeEditHistoryModal();
    renderItemList();
  }

  function deleteHistoryEntry(recIdx, histIdx) {
    const rec = db.categories[currentCategory].records[recIdx];
    if (!confirm("Delete this payment entry? This will also reduce the student's Total Paid accordingly.")) return;

    rec.history.splice(histIdx, 1);
    rec.paid = round2(rec.history.reduce((s, h) => s + h.amount, 0));
    saveData();
    renderItemList();
  }

  function deleteItem(idx) {
    const rec = db.categories[currentCategory].records[idx];
    if (confirm(`Remove ${rec.name} from "${currentCategory}"? (They stay in the student database.)`)) {
      db.categories[currentCategory].records.splice(idx, 1);
      editingIndex = null;
      saveData();
      renderItemList();
    }
  }

  /* =========================================================================
    CASHBOOK (ORGANIZATION-WIDE INCOME & EXPENSE LEDGER)
    -------------------------------------------------------------------------
    Separate from the per-student fee Collections above. This is the core
    general ledger an org treasurer keeps: every peso in (dues, sponsorship,
    event income) and every peso out (supplies, food, printing, etc.), with
    a running balance, OR/Voucher numbers for accountability, and optional
    linking to a Project/Event for liquidation reporting.
    ========================================================================= */

  const INCOME_CATEGORIES = [
    "General Income", // 🌟 ADD THIS FALLBACK ROW
    "Membership Dues", "Event Income", "Sponsorship / Donation",
    "Fundraising", "Reimbursement", "Other Income"
  ];
  
  const EXPENSE_CATEGORIES = [
    "General Expense", // 🌟 ADD THIS FALLBACK ROW
    "Supplies & Materials", "Food & Refreshments", "Printing & Documentation",
    "Transportation", "Permits & Fees", "Honorarium / Token",
    "Venue / Rentals", "Other Expense"
  ];

  function setTxnType(type) {
    document.getElementById("txn-type").value = type;
    document.getElementById("type-income-btn").classList.toggle("selected-income", type === "income");
    document.getElementById("type-expense-btn").classList.toggle("selected-expense", type === "expense");


  }

function renderClassFund() {
  const box = document.getElementById("classfund-list");
  const summary = document.getElementById("classfund-summary");
  const alertBox = document.getElementById("cf-missed-alert");
  const weekInfo = document.getElementById("cf-week-info");
  const txnBox = document.getElementById("cf-txn-log");
  if (!box || !summary) return;

  const cf = db.classFund;
  const weekly = cf.weeklyDue || 0;

  // Sync settings inputs
  const wInput = document.getElementById("cf-weekly-due");
  const sInput = document.getElementById("cf-start-date");
  if (wInput && (!wInput.value || wInput.value == "0")) wInput.value = weekly > 0 ? weekly : "";
  if (sInput && !sInput.value && cf.startDate) sInput.value = cf.startDate;

  const currentWeek = getExpectedWeeks(cf.startDate);
  if (weekInfo) {
    weekInfo.innerText = cf.startDate
      ? `Current Collection Week: Week ${currentWeek} • Weekly Due: ${peso(weekly)}`
      : "Set your weekly due and start date above to begin tracking.";
    weekInfo.style.color = cf.startDate ? "var(--accent)" : "var(--muted)";
  }

  const allStudents = Object.keys(cf.records || {}).sort();
  let totalExpected = 0, totalPaid = 0, missedCount = 0;
  allStudents.forEach(name => {
    totalExpected += getClassFundExpected(name);
    totalPaid += cf.records[name].paid || 0;
    missedCount += getMissedWeeks(name);
  });
  const totalUnpaid = round2(totalExpected - totalPaid);

  let students = allStudents;
  const searchInput = document.getElementById("cf-overlay-search") || document.getElementById("cf-search");
  const searchTerm = searchInput ? (searchInput.value || "").toLowerCase() : "";
  if (searchTerm) students = students.filter(n => n.toLowerCase().includes(searchTerm));

  const totalExpenses = round2((cf.transactions || [])
    .filter(t => t.type === "expense")
    .reduce((s, t) => s + (Number(t.amount) || 0), 0));
  const netBalance = round2(totalPaid - totalExpenses);

  summary.innerHTML = `
    <div class="summary-card"><h4>Total Collected</h4><p style="color:var(--success)">${peso(totalPaid)}</p></div>
    <div class="summary-card"><h4>Total Expenses</h4><p style="color:var(--danger)">${peso(totalExpenses)}</p></div>
    <div class="summary-card"><h4>Net Balance</h4><p style="color:${netBalance < 0 ? 'var(--danger)' : 'var(--accent-dark)'}">${peso(netBalance)}</p></div>
    <div class="summary-card"><h4>Enrolled</h4><p>${allStudents.length}</p></div>
  `;

  if (missedCount > 0 && totalUnpaid > 0) {
    alertBox.innerHTML = `
      <div class="missed-box">
        <h4>⚠ Collection Alert</h4>
        <p>${missedCount} total missed week(s) across all students</p>
        <span class="note">Unpaid student balance: ${peso(totalUnpaid)}</span>
      </div>
    `;
  } else {
    alertBox.innerHTML = "";
  }

  const countEl = document.getElementById("cf-count");
  if (countEl) countEl.innerText = `${students.length} student(s) shown • ${allStudents.length} enrolled in Class Fund`;

  if (students.length === 0) {
    box.innerHTML = `<p class="note">No students enrolled yet. Tap <b>+ Add All Students</b> above, or make sure students exist in the <b>Students</b> tab.</p>`;
  } else {
    box.innerHTML = students.map(name => {
      const rec = cf.records[name] || (cf.records[name] = { paid: 0, history: [] });
      rec.paid = Number(rec.paid) || 0;
      rec.history = Array.isArray(rec.history) ? rec.history : [];
      const expected = getClassFundExpected(name);
      const missed = getMissedWeeks(name);
      const balance = round2(expected - rec.paid);
      const lastPay = getLastPaymentDate(name);
      const safeId = encodeURIComponent(name);
      const isExpanded = cfExpandedNames.has(name);
      const lastPayText = lastPay ? `Last paid: ${formatDisplayDate(lastPay)}` : "Never paid";
      const progressPct = expected > 0 ? Math.min(100, (rec.paid / expected) * 100) : 0;

      return `
        <div class="cf-student-card ${isExpanded ? 'expanded' : ''}" id="cf-card-${safeId}" data-cf-name="${esc(name)}">
          <div class="cf-card-header-row" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
            <div>
              <div class="cf-name-badge-line" style="display:flex; align-items:center; gap:8px;">
                <span class="cf-student-title-name" style="font-weight:700;">${esc(name)}</span>
                <span class="cf-badge-minimal ${balance > 0 ? 'badg-warn' : 'badg-ok'}">${balance > 0 ? missed + ' weeks missed' : 'All Paid'}</span>
              </div>
              <div class="cf-minimal-subtext note">${lastPayText}</div>
            </div>
            <div class="cf-card-metrics-block" style="text-align:right;">
              <div class="cf-monospaced-bold-text ${balance > 0 ? 'txt-danger' : 'txt-success'}" style="font-weight:700;">${peso(rec.paid)}</div>
              <div class="cf-minimal-subtext note">of ${peso(expected)}</div>
              ${balance > 0 ? `<div class="cf-debt-indicator-line" style="color:var(--danger); font-size:11px;">-${peso(balance)}</div>` : ''}
            </div>
          </div>

          <div class="cf-details" id="cf-details-${safeId}" onclick="event.stopPropagation()" style="display:${isExpanded ? 'block' : 'none'}; width:100%; margin-top:12px;">
            <div class="minimal-progress-bar-container" style="background:rgba(0,0,0,0.05); height:6px; border-radius:3px; overflow:hidden; margin-bottom:10px;">
              <div class="minimal-progress-bar-fill" style="width:${progressPct}%; background:${balance > 0 ? '#b8872f' : '#166534'}; height:100%;"></div>
            </div>
            
            <div class="cf-payment-action-row-block">
              <button type="button" class="cf-minimalist-action-btn-trigger" onclick="openClassFundPaymentModal('${esc(name)}')">+ Add Payment</button>
            </div>
            
            ${rec.history.length > 0 ? `
              <div class="cf-minimalist-history-box-scroller">
                ${rec.history.map((h, hIdx) => `
                  <div class="cf-minimalist-history-entry-row">
                    <span class="cf-history-entry-log-text"><b>${peso(h.amount)}</b> on ${esc(formatDisplayDate(h.date))}</span>
                    <div class="cf-history-entry-actions-group">
                      <button type="button" class="cf-minimalist-del-action-btn" onclick="deleteClassFundPayment('${esc(name)}', ${hIdx})">DEL</button>
                    </div>
                  </div>
                `).reverse().join("")}  
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join("");
  }

  // --- Class Fund Ledger Section ---
  if (txnBox) {
    const incomeEntries = [];
    Object.entries(cf.records || {}).forEach(([name, rec]) => {
      (rec.history || []).forEach((h, idx) => {
        incomeEntries.push({
          sortKey: `${h.date || "0000-00-00"}-INC-${String(idx).padStart(4, '0')}-${name}`,
          type: "income",
          date: h.date,
          description: `Payment from ${name}`,
          amount: h.amount,
          note: h.note || "",
          student: name,
          histIdx: idx,
          deletable: false
        });
      });
    });

    const expenseEntries = (cf.transactions || [])
      .filter(t => t.type === "expense")
      .map(t => ({
        sortKey: `${t.date || "0000-00-00"}-EXP-${t.id}`,
        ...t,
        deletable: true
      }));

    const allTxns = [...incomeEntries, ...expenseEntries].sort((a, b) =>
      a.sortKey.localeCompare(b.sortKey)
    );

    let running = 0;
    const withBal = allTxns.map(t => {
      running = round2(running + (t.type === "income" ? t.amount : -t.amount));
      return { ...t, balance: running };
    }).reverse();

    if (withBal.length === 0) {
      txnBox.innerHTML = `<p class="note">No transactions yet. Record student payments or expenses above.</p>`;
    } else {
      txnBox.innerHTML = withBal.map(t => {
        const sign = t.type === "income" ? "+" : "−";
        const color = t.type === "income" ? "var(--success)" : "var(--danger)";
        const clickAttrs = t.type === "income"
          ? `data-cf-type="income" data-cf-student="${esc(t.student)}" data-cf-histidx="${t.histIdx}"`
          : `data-cf-type="expense" data-cf-id="${esc(t.id)}"`;

        return `
          <div class="item-row" ${clickAttrs} style="background:#fff; padding:12px 14px; border-bottom:1px solid rgba(0,0,0,0.05); display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
            <div style="text-align:left;">
              <b style="color:#1F2A24 !important;">${esc(t.description)}</b><br>
              <span class="note" style="color:#55625A !important; font-size:12px;">${esc(t.date)}${t.note ? ' • ' + esc(t.note) : ''}</span>
            </div>
            <div style="text-align:right;">
              <span style="color:${color}; font-weight:700; font-family:'IBM Plex Mono',monospace;">${sign}${peso(t.amount)}</span><br>
              <span class="note" style="color:#55625A !important; font-size:11px;">Bal: ${peso(t.balance)}</span>
            </div>
          </div>
        `;
      }).join("");

      txnBox.querySelectorAll('[data-cf-type]').forEach(el => {
        el.addEventListener('click', () => {
          if (el.dataset.cfType === 'income') {
            openCfLedgerEdit('income', el.dataset.cfStudent, parseInt(el.dataset.cfHistidx, 10));
          } else {
            openCfLedgerEdit('expense', el.dataset.cfId);
          }
        });
      });
    }
  }

  syncCfStudentsOverlay();
  syncCfLedgerOverlay();
}


  let cashbookLogKind = "all";
  let cashbookEditingId = null;

function isRemittanceTxn(txn) {
  if (!txn) return false;
  const typeStr = String(txn.type || "").toLowerCase();
  const catStr = String(txn.category || "").toLowerCase();
  const descStr = String(txn.description || "").toLowerCase();
  
  // Comprehensive check across type flags, descriptions, and category string variables
  // Included 'year-level remitted' and matching checks to support the new terminology
  return typeStr === "remittance" || 
         catStr === "year-level remittance" ||
         catStr === "year-level remittance logs" ||
         catStr === "year-level remitted" ||
         /remittance/i.test(catStr) || 
         /remittance/i.test(descStr) ||
         /remitted/i.test(catStr);
}


function openCashbookLog(kind) {
    cashbookLogKind = kind || "all";
    const overlay = document.getElementById("cashbook-log-overlay");
    if (!overlay) return;
    
    // Changed "Year-Level Remittance Logs" to "Year-Level Remitted"
    document.getElementById("cashbook-log-title").innerText = kind === "remittance"
      ? "Year-Level Remitted"
      : kind === "general" ? "Income & Expense Logs" : "All Cashbook Logs";
      
    document.getElementById("cashbook-log-search").value = "";
    
    // 1. DYNAMICALLY INJECT AND FORCE SYNCHRONIZE CHANNELS INITIALIZATION
    const searchInput = document.getElementById("cashbook-log-search");
    if (searchInput && kind !== "remittance") {
      let filterWrapper = document.getElementById("cashbook-log-filter-wrapper");
      if (!filterWrapper) {
        filterWrapper = document.createElement("div");
        filterWrapper.id = "cashbook-log-filter-wrapper";
        filterWrapper.style.marginTop = "10px";
        filterWrapper.style.marginBottom = "10px";
        filterWrapper.innerHTML = `
          <select id="cashbook-log-type-filter" onchange="renderCashbookLog()" style="width:100%; padding:10px; border-radius:var(--radius-sm); border:1px solid rgba(0,0,0,0.15); background:#fff; color:#1F2A24; font-size:14px; font-weight:600;">
            <option value="all">📁 Show All Transactions</option>
            <option value="income">➕ Income Only</option>
            <option value="expense">− Expenses Only</option>
          </select>
        `;
        searchInput.parentNode.insertBefore(filterWrapper, searchInput.nextSibling);
      } else {
        filterWrapper.style.display = "block";
      }
      
      // 🌟 FIXED: Explicitly force selection parameters layout assignment 
      // right here so the very first rendering cycle has a reliable fallback state
      const selectElement = document.getElementById("cashbook-log-type-filter");
      if (selectElement) {
        selectElement.value = "all";
      }
    } else {
      const existingWrapper = document.getElementById("cashbook-log-filter-wrapper");
      if (existingWrapper) existingWrapper.style.display = "none";
    }
    
    // 2. PLACE THE SCANNER HOOK HERE (Watches search field typing entries)
    const searchInputBoxNode = document.getElementById("cashbook-log-search");
    if (searchInputBoxNode) {
      searchInputBoxNode.removeEventListener("input", renderCashbookLog);
      searchInputBoxNode.addEventListener("input", renderCashbookLog);
    }
    
    overlay.classList.remove("hidden");
    
    // 🌟 FIXED: Defer your render sequence inside a micro requestAnimationFrame loop 
    // to give the WebView canvas layout thread time to bind selection fields completely
    requestAnimationFrame(() => {
      renderCashbookLog();
    });
}



// A transaction only counts as "manually recorded" if its category matches
// the fixed dropdown lists used by the Record Transaction form. This is
// what excludes auto-logged collection payments ("Year Levels Payment")
// and remittances from the "Income & Expenses" log.
// FIXED: Allows direct collection payments to pass through the UI rendering pipeline
function isManualCashbookTxn(txn) {
  if (!txn) return false;
  const cat = txn.category || "";
  // Validates if it belongs to standard lists OR is an explicit direct remittance entry
  return INCOME_CATEGORIES.includes(cat) || 
         EXPENSE_CATEGORIES.includes(cat) || 
         txn.type === "remittance" || 
         String(txn.type).toLowerCase() === "remittance" ||
         cat === "Year-Level Remittance" ||
         /remittance/i.test(cat);
}



function getCashbookLogTransactions() {
  const searchInput = document.getElementById("cashbook-log-search");
  const search = (searchInput ? searchInput.value : "").toLowerCase();
  
  // Scrapes choice value rules from filter menu options safely
  const typeFilterInput = document.getElementById("cashbook-log-type-filter");
  const typeFilter = typeFilterInput ? typeFilterInput.value : "all";
  
  if (!db.cashbook || !Array.isArray(db.cashbook.transactions)) return [];
  
  return db.cashbook.transactions.filter(txn => {
    const remittance = isRemittanceTxn(txn);
    let kindMatch = false;
    
    if (cashbookLogKind === "remittance") {
      kindMatch = remittance;
    } else if (cashbookLogKind === "general") {
      kindMatch = !remittance && isManualCashbookTxn(txn);
    } else {
      kindMatch = true; 
    }
    
    // FIXED: Strict evaluation to toggle rows cleanly matching option selection targets
    const typeMatch = typeFilter === "all" || txn.type === typeFilter;
    const text = `${txn.date || ""} ${txn.type || ""} ${txn.category || ""} ${txn.description || ""} ${txn.notes || ""}`.toLowerCase();
    
    return kindMatch && typeMatch && text.includes(search);
  }).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}




  function closeCashbookLog() {
    document.getElementById("cashbook-log-overlay")?.classList.add("hidden");
  }

  function exportCashbookLog() {
    const search = (document.getElementById("cashbook-log-search")?.value || "").toLowerCase();
    const transactions = db.cashbook.transactions.filter(txn => {
      const remittance = isRemittanceTxn(txn);
      const kindMatch = cashbookLogKind === "all" || (cashbookLogKind === "remittance" ? remittance : !remittance);
      const text = `${txn.date} ${txn.type} ${txn.category} ${txn.description} ${txn.notes || ""}`.toLowerCase();
      return kindMatch && text.includes(search);
    }).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const cell = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = "Date,Type,Category,Description,Amount,Notes\r\n" + transactions.map(txn => [
      txn.date, txn.type, txn.category, txn.description, txn.amount, txn.notes || ""
    ].map(cell).join(",")).join("\r\n") + "\r\n";
    exportFileCrossPlatform(csv, `cashbook-${cashbookLogKind || "all"}-logs.csv`, "text/csv", "Export Cashbook Log");
  }


function renderCashbookLog() {
  const box = document.getElementById("cashbook-log-list");
  if (!box) return;
  
  const transactions = getCashbookLogTransactions();
  
  if (transactions.length === 0) {
    box.innerHTML = `<p class="note" style="text-align:center; padding:20px; color:#6E7A72;">No transactions found in this log selection folder.</p>`;
    return;
  }
  
  box.innerHTML = transactions.map(txn => {
    // Check if the entry is an automated turnover log
    const isTurnover = String(txn.description).includes("Turnover of all collected funds");
    const isExpense = txn.type === "expense" || isTurnover; // Forces turnover to show as a deduction look
    
    const sign = isExpense ? "−" : "+";
    const cssClass = isExpense ? "status-unpaid" : "status-paid";
    const displayCategory = txn.category || "Remittance Log Entry";
    
    // 🌟 LOOKUP: Find the project name from the database if a project is linked
    let projectParenthesis = "";
    if (txn.projectId && Array.isArray(db.projects)) {
      const linkedProject = db.projects.find(p => String(p.id) === String(txn.projectId));
      if (linkedProject && linkedProject.name) {
        projectParenthesis = ` <span class="note" style="font-weight: 500; font-size: 13px; color: var(--muted); opacity: 0.85;">(${esc(linkedProject.name)})</span>`;
      }
    }
    
    return `
      <div class="cashbook-log-row" style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border-bottom:1px solid rgba(0,0,0,0.06); background:#fff;">
        <div style="text-align:left; flex:1; min-width:0; padding-right:10px;">
          <!-- 🌟 FORMATTING: Appended the projectParenthesis right next to description -->
          <b style="color:#1F2A24 !important; font-size:14px; font-weight:700; display:inline-block; margin-bottom:3px; word-break:break-word;">
            ${esc(txn.description)}${projectParenthesis}
          </b><br>
          <span class="note" style="font-size:12px; color:#55625A !important; font-family:'IBM Plex Mono',monospace;">${esc(txn.date)} • ${esc(displayCategory)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:14px; text-align:right; flex-shrink:0;">
          <strong class="${cssClass}" style="font-family:'IBM Plex Mono',monospace; font-size:15px; font-weight:700;">${sign}${peso(txn.amount)}</strong>
          <button class="mini-btn mini-delete" data-cashbook-delete="${esc(txn.id)}" style="padding:6px 12px; font-size:12px; font-weight:600; background:#b3423b; color:#fff; border:none; border-radius:4px; cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,0.15);">Delete</button>
        </div>
      </div>
    `;
  }).join("");
  
  // Rebind native button click handlers
  box.querySelectorAll("[data-cashbook-delete]").forEach(button => {
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      const targetId = button.dataset.cashbookDelete;
      if (!targetId) return;
      
      if (!confirm("Permanently wipe this transaction? It will automatically cascade and adjust source items.")) return;
      
      // 🌟 REVERSION LOGIC: If a user deletes an automated turnover, restore its category status
      const targetTxn = db.cashbook.transactions.find(t => String(t.id) === String(targetId));
      if (targetTxn && targetTxn.description && targetTxn.description.includes("Turnover of all collected funds")) {
        // Extract the category name safely from description (e.g. "Remittance from SSC — Turnover...")
        const rawName = targetTxn.description.replace("Remittance from ", "");
        const splitIndex = rawName.indexOf(" — ");
        const categoryKey = splitIndex !== -1 ? rawName.substring(0, splitIndex).trim() : rawName.trim();
        
        if (db.categories[categoryKey]) {
          db.categories[categoryKey].remittanceStatus = "unremitted"; // Revert flag state to active open
        }
      }
      
      db.cashbook.transactions = db.cashbook.transactions.filter(t => String(t.id) !== String(targetId));
      saveData();
      
      // 🌟 LIVE SYNCHRONIZATION: Update your totals and list rows immediately across screens
      renderSummary();          // <-- Refreshes TOTAL COLLECTED back to ₱510.00 instantly on deletion
      renderCategories();       // <-- Refreshes your list row circles and badges 
      renderCashbookLog(); 
      renderCashbookSummary();
      renderCashbookList();
      if (typeof renderItemList === "function") renderItemList();
    });
  });
}






  function openRemittanceModal() {
    const select = document.getElementById("remittance-year-level");
    select.innerHTML = db.students.map(yearLevel => `<option value="${esc(yearLevel.name)}">${esc(yearLevel.name)}</option>`).join("");
    document.getElementById("remittance-date").value = new Date().toISOString().slice(0, 10);
    document.getElementById("remittance-amount").value = "";
    document.getElementById("remittance-note").value = "";
    document.getElementById("remittance-modal").classList.remove("hidden");
  }

  function closeRemittanceModal() {
    document.getElementById("remittance-modal")?.classList.add("hidden");
  }

  function saveRemittance() {
    const yearLevel = document.getElementById("remittance-year-level").value;
    const amount = round2(parseFloat(document.getElementById("remittance-amount").value) || 0);
    if (!yearLevel || amount <= 0) return eveAlert("Choose a year level and enter a valid amount.", true);
    db.cashbook.transactions.push({
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      type: "remittance",
      date: document.getElementById("remittance-date").value || new Date().toISOString().slice(0, 10),
      orNumber: "",
      category: "Year-Level Remittance",
      description: `Remittance from ${yearLevel}`,
      amount,
      projectId: null,
      notes: document.getElementById("remittance-note").value.trim()
    });
    saveData();
    closeRemittanceModal();
    renderCashbookSummary();
    renderCashbookList();
    eveAlert("Remittance recorded.");
  }

function saveTransaction() {
    const type = document.getElementById("txn-type").value;
    const dateInput = document.getElementById("txn-date").value;
    const date = dateInput || new Date().toISOString().slice(0, 10);
    const orNumber = "";
    const category = type === "income" ? "General Income" : "General Expense";
    const description = document.getElementById("txn-description").value.trim();
    const amount = round2(parseFloat(document.getElementById("txn-amount").value) || 0);
    const projectId = document.getElementById("txn-project-select").value || null;
    const notes = document.getElementById("txn-notes").value.trim();
    const editId = document.getElementById("txn-edit-id").value;

    if (!description) return eveAlert("Please enter a description for this transaction.", true);
    if (!category) return eveAlert("Please select a category.", true);
    if (amount <= 0) return eveAlert("Please enter a valid amount greater than zero.", true);

    if (editId) {
      const txn = db.cashbook.transactions.find(t => String(t.id) === String(editId));
      if (txn) Object.assign(txn, { type, date, orNumber, category, description, amount, projectId, notes });
    } else {
      db.cashbook.transactions.push({
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        type, date, orNumber, category, description, amount, projectId, notes
      });
    }

    saveData();
    const wasEdit = !!editId;
    const alertMessage = wasEdit ? "Transaction updated." : "Transaction recorded.";

    // 🌟 STEP A: Call alert with false to run the native smile track
    eveAlert(alertMessage, false);

    // 🌟 STEP B: Instantly append a success-active class to the speech bubble element
    const bubble = document.getElementById('speechBubble');
    if (bubble) {
      bubble.classList.add('success-active');
    }

    // 🌟 STEP C: Defer field clears slightly so they don't crash active animations
    setTimeout(() => {
      resetTxnForm();
      renderCashbookSummary();
      renderCashbookList();
      renderProjects();
    }, 50);
}


  function editTransactionRow(id) {
    const txn = db.cashbook.transactions.find(t => String(t.id) === String(id));
    if (!txn) return;

    openCashbookEdit(id);
  }

  function openCashbookEdit(id) {
    const txn = db.cashbook.transactions.find(t => String(t.id) === String(id));
    if (!txn) return;
    cashbookEditingId = txn.id;
    const isClassFundPayment =
  !!txn.classFundPaymentId;

const categoryInput =
  document.getElementById(
    "cashbook-edit-category"
  );

const descriptionInput =
  document.getElementById(
    "cashbook-edit-description"
  );

if (isClassFundPayment) {

  if (categoryInput) {
    categoryInput.disabled = true;
  }

  if (descriptionInput) {
    descriptionInput.disabled = true;
  }

} else {

  if (categoryInput) {
    categoryInput.disabled = false;
  }

  if (descriptionInput) {
    descriptionInput.disabled = false;
  }
}
    document.getElementById("cashbook-edit-date").value = txn.date || "";
    document.getElementById("cashbook-edit-type").value = txn.type === "expense" ? "expense" : txn.type === "remittance" ? "remittance" : "income";
    document.getElementById("cashbook-edit-category").value = txn.category || "";
    document.getElementById("cashbook-edit-description").value = txn.description || "";
    document.getElementById("cashbook-edit-amount").value = txn.amount || "";
    document.getElementById("cashbook-edit-notes").value = txn.notes || "";
    document.getElementById("cashbook-edit-modal").classList.remove("hidden");
  }

  function closeCashbookEdit() {
    cashbookEditingId = null;
    document.getElementById("cashbook-edit-modal")?.classList.add("hidden");
  }

function saveCashbookEdit() {
  const txn = db.cashbook.transactions.find(
    t => String(t.id) === String(cashbookEditingId)
  );

  if (!txn) {
    return eveAlert("Transaction no longer exists.", true);
  }

  const amount = round2(
    parseFloat(
      document.getElementById("cashbook-edit-amount").value
    ) || 0
  );

  if (amount <= 0) {
    return eveAlert("Enter a valid amount.", true);
  }

   // ==========================================
// CLASS FUND LINKED TRANSACTION
// ==========================================

if (txn.classFundPaymentId) {

  const studentName =
    txn.classFundStudent;

  const rec =
    db.classFund.records?.[studentName];

  if (
    rec &&
    Array.isArray(rec.history)
  ) {

    const entry =
      rec.history.find(
        h =>
          String(h.id) ===
          String(txn.classFundPaymentId)
      );

    if (entry) {

      entry.date = txn.date;
      entry.amount = amount;
      entry.note = txn.notes || "";

      rec.paid = round2(
        rec.history.reduce(
          (sum, item) =>
            sum +
            (Number(item.amount) || 0),
          0
        )
      );
    }
  }

  // Keep the Cash Book transaction clearly identified
  txn.type = "income";
  txn.category = "Class Fund Payment";
  txn.description =
    `Class Fund Payment from ${studentName}`;
}


  const date =
    document.getElementById("cashbook-edit-date").value ||
    txn.date ||
    new Date().toISOString().slice(0, 10);

  const type =
    document.getElementById("cashbook-edit-type").value;

  const category =
    document.getElementById("cashbook-edit-category").value.trim();

  const description =
    document.getElementById("cashbook-edit-description").value.trim();

  const notes =
    document.getElementById("cashbook-edit-notes").value.trim();

  if (!category) {
    return eveAlert("Please enter a category.", true);
  }

  if (!description) {
    return eveAlert("Please enter a description.", true);
  }

  txn.date = date;
  txn.type = type;
  txn.category = category;
  txn.description = description;
  txn.amount = amount;
  txn.notes = notes;

  // Preserve existing OR/Voucher number.
  // Add an edit field later if you want to change it.
  txn.orNumber = txn.orNumber || "";

  // Keep existing project relationship.
  txn.projectId = txn.projectId || null;

  saveData();

  closeCashbookEdit();

  renderCashbookSummary();
  renderCashbookList();
  renderCashbookLog();
  renderProjects();

  eveAlert("Transaction updated.");
}

function deleteCashbookEdit() {
  if (!cashbookEditingId) return;
  if (!confirm("Permanently wipe this transaction? It will automatically cascade and adjust source items.")) return;
  
  const targetId = cashbookEditingId;
  
  // Scan all collections for references to clean out source indices cleanly
  Object.keys(db.categories).forEach(catName => {
    db.categories[catName].records.forEach(rec => {
      if (Array.isArray(rec.history)) {
        const matchIndex = rec.history.findIndex(h => String(h.id) === String(targetId));
        if (matchIndex !== -1) {
          rec.history.splice(matchIndex, 1);
          rec.paid = round2(rec.history.reduce((sum, h) => sum + h.amount, 0));
        }
      }
    });
  });
  
  db.cashbook.transactions = db.cashbook.transactions.filter(t => String(t.id) !== String(targetId));
  
  saveData();
  closeCashbookEdit();
  renderCashbookSummary();
  renderCashbookList();
  if (typeof renderCashbookLog === "function") renderCashbookLog();
  renderSummary();
  eveAlert("Transaction cleared from general ledgers and source profiles.");
}

  function openOpeningBalanceModal() {
    const current = db.cashbook.openingBalance || 0;
    const val = prompt("Set Opening / Beginning Cash Balance for the Cash Book:", current);
    if (val === null) return;
    const num = parseFloat(val);
    if (isNaN(num) || num < 0) return eveAlert("Please enter a valid non-negative amount.", true);
    db.cashbook.openingBalance = round2(num);
    saveData();
    renderCashbookSummary();
    renderCashbookList();
  }

function computeCashbookTotals() {
  const opening = db.cashbook.openingBalance || 0;

  // An automated "closeout" entry logged when a whole collection category is
  // marked as turned over — it re-logs money that's already been counted once
  // via the individual payment/remittance entries, so it must be treated as
  // cash LEAVING the box, not as new income (renderCashbookLog already shows
  // it with a "−" sign for this same reason).
  const isTurnoverLog = t => t.type === "remittance" && /Turnover of all collected funds/i.test(String(t.description || ""));

  // 1. Total standard manual income entries
  const totalIncome = round2(
    db.cashbook.transactions
      .filter(t => t.type === "income")
      .reduce((s, t) => s + (Number(t.amount) || 0), 0)
  );

  // 2. Total manual expense entries
  const totalExpense = round2(
    db.cashbook.transactions
      .filter(t => t.type === "expense")
      .reduce((s, t) => s + (Number(t.amount) || 0), 0)
  );

  // 3. Total amount actually turned over to the Main Treasurer — this is what
  //    the "TOTAL REMITS" card should show.
  // The Cash Book TOTAL REMITS card is intentionally synchronized with the
  // Summary TOTAL COLLECTED card: both show the remaining amount after the
  // collection remittance toggle is applied.
  const remittanceTotals = getCollectionRemittanceTotals();
  const totalRemits = remittanceTotals.remainingCollected;

  // 4. Cash On Hand: opening balance + all direct cashbook income + money still
  //    collected-but-not-yet-remitted from the collections (Total Remits),
  //    minus expenses actually paid out.
  const cashOnHand = round2(opening + totalIncome + totalRemits - totalExpense);

  return { opening, totalIncome, totalExpense, totalRemits, cashOnHand };
}







function renderCashbookSummary() {
  const el = document.getElementById("cashbook-summary");
  if (!el) return;
  const { opening, totalIncome, totalExpense, totalRemits, cashOnHand } = computeCashbookTotals();
  
  // Modifies layout architecture blueprint smoothly into a flexible multi-box grid block row
  el.innerHTML = `
    <div class="summary-card eve-summary-card" data-summary-title="Opening Balance" data-summary-section="Cashbook">
      <h4>OPENING BALANCE</h4>
      <p>${peso(opening)}</p>
    </div>
    <div class="summary-card eve-summary-card" data-summary-title="Total Income" data-summary-section="Cashbook">
      <h4>TOTAL INCOME</h4>
      <p style="color:var(--success)">${peso(totalIncome)}</p>
    </div>
    <div class="summary-card eve-summary-card" data-summary-title="Total Expenses" data-summary-section="Cashbook">
      <h4>TOTAL EXPENSES</h4>
      <p style="color:var(--danger)">${peso(totalExpense)}</p>
    </div>
    <div class="summary-card eve-summary-card" data-summary-title="Total Remits" data-summary-section="Cashbook" style="border: 1px dashed var(--accent-2);">
      <h4>TOTAL REMITS</h4>
      <p style="color:var(--warning)">${peso(totalRemits)}</p>
    </div>
    <div class="summary-card eve-summary-card" data-summary-title="Cash On Hand" data-summary-section="Cashbook" style="grid-column: span 2;">
      <h4>CASH ON HAND</h4>
      <p style="color:${cashOnHand < 0 ? 'var(--danger)' : 'var(--accent-dark)'}">${peso(cashOnHand)}</p>
    </div>
  `;
  
  // Re-link click listeners to enable dynamic sub-panel details popups via EVE
  el.querySelectorAll('.eve-summary-card').forEach(card => {
    card.addEventListener('click', () => {
      const title = card.getAttribute('data-summary-title');
      const section = card.getAttribute('data-summary-section');
      openEveSummaryDetail(title, section);
    });
  });
}



function renderCashbookList() {
  const box = document.getElementById("cashbook-list");
  if (!box) return;
  const search = (document.getElementById("cashbook-search")?.value || "").toLowerCase();
  const typeFilter = document.getElementById("cashbook-filter-type")?.value || "all";

  // Compute a running balance in chronological order first...
  const sortedAsc = [...db.cashbook.transactions].sort((a, b) =>
    (a.date || "").localeCompare(b.date || "") || String(a.id).localeCompare(String(b.id))
  );
  let running = db.cashbook.openingBalance || 0;
  const withBalance = sortedAsc.map(t => {
    running = round2(running + (t.type === "income" || t.type === "remittance" ? t.amount : -t.amount));
    return { ...t, balance: running };
  });

  // ...then filter and show most-recent-first.
  let filtered = withBalance.filter(t => {
    if (typeFilter === "remittance" && !isRemittanceTxn(t)) return false;
    if (typeFilter !== "all" && typeFilter !== "remittance" && t.type !== typeFilter) return false;
    if (!search) return true;
    const projName = t.projectId ? ((db.projects.find(p => String(p.id) === String(t.projectId)) || {}).name || "") : "";
    return String(t.description || "")
       .toLowerCase()
       .includes(search) ||
     String(t.category || "")
       .toLowerCase()
       .includes(search) ||
     String(t.orNumber || "")
       .toLowerCase()
       .includes(search) ||
     String(projName || "")
       .toLowerCase()
       .includes(search);
  }).reverse();

  const countEl = document.getElementById("cashbook-count");
  if (countEl) {
    countEl.innerText = `${filtered.length} of ${db.cashbook.transactions.length} transaction${db.cashbook.transactions.length !== 1 ? 's' : ''} shown`;
  }

  if (filtered.length === 0) {
    box.innerHTML = `<p class="note">${db.cashbook.transactions.length === 0 ? 'No transactions recorded yet. Use the form above to log your first income or expense.' : 'No transaction matches your search/filter.'}</p>`;
    return;
  }

  box.innerHTML = filtered.map(t => {
    const projName = t.projectId ? (db.projects.find(p => String(p.id) === String(t.projectId)) || {}).name : null;
    const sign = t.type === "expense" ? "−" : "+";
    const color = t.type === "expense" ? "var(--danger)" : "var(--success)";
    return `
      <div class="item-row" data-action="edit-txn" data-id="${t.id}">
        <div>
          <b>${esc(t.description)}</b><br>
          <span class="note">${esc(t.category)}${t.orNumber ? ' • OR#' + esc(t.orNumber) : ''}${projName ? ' • 📁 ' + esc(projName) : ''} • ${esc(t.date)}</span>
        </div>
        <div style="text-align:right;">
          <span style="color:${color}; font-weight:900;">${sign}${peso(t.amount)}</span><br>
          <span class="note">Bal: ${peso(t.balance)}</span>
        </div>
      </div>`;
  }).join("");

  box.querySelectorAll('[data-action="edit-txn"]').forEach(el => {
    el.addEventListener('click', () => editTransactionRow(el.dataset.id));
  });
  
  // FIXED: Catches background change triggers to sync layouts seamlessly
  box.querySelectorAll("[data-cashbook-delete]").forEach(btn => {
    btn.addEventListener("click", () => {
       setTimeout(() => { renderCashbookLog(); }, 50);
    });
  });
}


  async function exportCashbookCSV() {
    if (db.cashbook.transactions.length === 0) return eveAlert("No transactions to export yet.");

    const sortedAsc = [...db.cashbook.transactions].sort((a, b) =>
      (a.date || "").localeCompare(b.date || "") || String(a.id).localeCompare(String(b.id))
    );
    let running = db.cashbook.openingBalance || 0;

    let csv = "Date,Type,Category,Description,OR/Voucher No.,Project,Amount,Running Balance";
    sortedAsc.forEach(t => {
      running = round2(running + (t.type === "income" || t.type === "remittance" ? t.amount : -t.amount));
      const projName = t.projectId ? ((db.projects.find(p => String(p.id) === String(t.projectId)) || {}).name || "") : "";
      const safeDesc = t.description.replace(/"/g, '""');
      const safeProj = projName.replace(/"/g, '""');
      csv += `
  ${t.date},${t.type === "expense" ? "Expense" : t.type === "remittance" ? "Remittance" : "Income"},"${t.category}","${safeDesc}","${t.orNumber || ""}","${safeProj}",${t.amount.toFixed(2)},${running.toFixed(2)}`;
    });

    await exportFileCrossPlatform(csv, `cashbook-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv", "Export Cash Book");
  }

  /* ---------------- PROJECTS / EVENTS (budget + liquidation) ---------------- */

  function addProject() {
    const nameInput = document.getElementById("new-project-name");
    const budgetInput = document.getElementById("new-project-budget");
    const name = nameInput.value.trim();
    const budget = round2(parseFloat(budgetInput.value) || 0);

    if (!name) return eveAlert("Please enter a project or event name.", true);
    if (db.projects.some(p => p.name.toLowerCase() === name.toLowerCase())) return eveAlert("A project with that name already exists.", true);

    db.projects.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), name, budget, status: "active" });
    saveData();
    nameInput.value = "";
    budgetInput.value = "";
    renderProjects();
  }

  function deleteProject(id) {
    const hasLinked = db.cashbook.transactions.some(t => String(t.projectId) === String(id));
    const msg = hasLinked
      ? "This project has linked transactions. They will stay in the Cash Book but will no longer be linked to a project. Continue?"
      : "Delete this project?";
    if (!confirm(msg)) return;

    db.cashbook.transactions.forEach(t => { if (String(t.projectId) === String(id)) t.projectId = null; });
    db.projects = db.projects.filter(p => String(p.id) !== String(id));
    saveData();
    renderProjects();
    renderCashbookList();
  }

  function renderProjects() {
    const box = document.getElementById("projects-list");
    if (!box) return;

    if (db.projects.length === 0) {
      box.innerHTML = `<p class="note">No projects/events yet. Add one above to track its budget, income raised, and expenses separately from the general fund.</p>`;
      return;
    }

    box.innerHTML = [...db.projects].sort((a, b) => a.name.localeCompare(b.name)).map(p => {
      const spent = round2(db.cashbook.transactions.filter(t => String(t.projectId) === String(p.id) && t.type === "expense").reduce((s, t) => s + (Number(t.amount) || 0), 0));
     const income = round2(
  db.cashbook.transactions
    .filter(t =>
      String(t.projectId) === String(p.id) &&
      (t.type === "income" || t.type === "remittance")
    )
    .reduce((s, t) => s + (Number(t.amount) || 0), 0)
);
      const remaining = round2(p.budget - spent);
      const remainingStr = p.budget > 0 ? ` • Remaining: ${peso(remaining)}` : "";
      const incomeStr = income > 0 ? ` • Income: ${peso(income)}` : "";
      return `
        <div class="card" data-action="view-project" data-id="${p.id}">
          <span>${esc(p.name)}<br>
          <span class="note">Budget: ${peso(p.budget)} • Spent: ${peso(spent)}${incomeStr}${remainingStr}</span></span>
          <button class="del-btn" data-action="delete-project" data-id="${p.id}">X</button>
        </div>`;
    }).join("");

    box.querySelectorAll('[data-action="view-project"]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="delete-project"]')) return;
        showProjectDetail(el.dataset.id);
      });
    });
    box.querySelectorAll('[data-action="delete-project"]').forEach(el => {
      el.addEventListener('click', (e) => { e.stopPropagation(); deleteProject(el.dataset.id); });
    });
  }

function showProjectsView() {
  // Hide the normal Cash Book content
  document.getElementById("cashbook-main-view")?.classList.add("hidden");
  
  // 🚫 THIS IS REMOVING YOUR RECORD TRANSACTION FORMS AND BUTTONS!
  document.querySelector(".cashbook-record-box")?.classList.add("hidden");
  document.getElementById("financial-statement-section")?.classList.add("hidden");
  document.querySelector(".cashbook-record-box")?.previousElementSibling?.classList.add("hidden");

  document.getElementById("project-detail-view")?.classList.add("hidden");
  document.getElementById("projects-view")?.classList.remove("hidden");
  renderProjects();
}


function hideProjectsView() {
  // Hide Projects & Events
  document.getElementById("projects-view")?.classList.add("hidden");
  document.getElementById("project-detail-view")?.classList.add("hidden");

  // Restore normal Cash Book
  document.getElementById("cashbook-main-view")?.classList.remove("hidden");

  // Restore Record Transaction
  document.querySelector(".cashbook-record-box")?.classList.remove("hidden");

  // Restore Organization Info / Financial Statement
  document.getElementById("financial-statement-section")?.classList.remove("hidden");

  // Restore divider
  document.querySelector(".cashbook-record-box")
    ?.previousElementSibling?.classList.remove("hidden");
}

  function backToProjectsList() {
    document.getElementById("project-detail-view").classList.add("hidden");
    document.getElementById("projects-view").classList.remove("hidden");
  }

  function showProjectDetail(id) {
    const p = db.projects.find(pr => String(pr.id) === String(id));
    if (!p) return;

    document.getElementById("projects-view").classList.add("hidden");
    document.getElementById("project-detail-view").classList.remove("hidden");
    document.getElementById("project-detail-name").innerText = p.name.toUpperCase();

    const txns = db.cashbook.transactions
      .filter(t => String(t.projectId) === String(id))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    const spent = round2(txns.filter(t => t.type === "expense").reduce((s, t) => s + (Number(t.amount) || 0), 0));
    const income = round2(
  txns
    .filter(t =>
      t.type === "income" ||
      t.type === "remittance"
    )
    .reduce((s, t) => s + (Number(t.amount) || 0), 0)
);
    const remaining = round2(p.budget - spent);

    document.getElementById("project-detail-summary").innerHTML = `
      <div class="summary-card"><h4>Budget</h4><p>${peso(p.budget)}</p></div>
      <div class="summary-card"><h4>Spent</h4><p style="color:var(--danger)">${peso(spent)}</p></div>
      <div class="summary-card"><h4>Income Raised</h4><p style="color:var(--success)">${peso(income)}</p></div>
      <div class="summary-card"><h4>Remaining Budget</h4><p style="color:${remaining < 0 ? 'var(--danger)' : 'var(--accent-dark)'}">${peso(remaining)}</p></div>
    `;

    document.getElementById("project-detail-txns").innerHTML = txns.length ? txns.map(t => {
      const sign = t.type === "income" ? "+" : "−";
      const color = t.type === "income" ? "var(--success)" : "var(--danger)";
      return `<div class="breakdown-card">
        <div class="breakdown-top"><b>${esc(t.description)}</b><span style="color:${color};">${sign}${peso(t.amount)}</span></div>
        <span class="note">${esc(t.category)} • ${esc(t.date)}${t.orNumber ? ' • OR#' + esc(t.orNumber) : ''}</span>
      </div>`;
    }).join("") : `<p class="note">No transactions linked to this project yet. Link one by picking it in the Cash Book form.</p>`;
  }

  /* =========================================================================
    ORGANIZATION INFO
    ========================================================================= */

  function saveOrgSettings() {
    db.orgSettings.orgName = document.getElementById("org-name").value.trim();
    db.orgSettings.treasurerName = document.getElementById("org-treasurer").value.trim();
    db.orgSettings.presidentName = document.getElementById("org-president").value.trim();
    db.orgSettings.schoolYear = document.getElementById("org-sy").value.trim();
    saveData();
    updateAppHeader();
    eveAlert("Organization info saved.");
  }

  function loadOrgSettingsForm() {
    document.getElementById("org-name").value = db.orgSettings.orgName || "";
    document.getElementById("org-treasurer").value = db.orgSettings.treasurerName || "";
    document.getElementById("org-president").value = db.orgSettings.presidentName || "";
    document.getElementById("org-sy").value = db.orgSettings.schoolYear || "";
  }

  function updateAppHeader() {
    const eyebrow = document.querySelector(".eyebrow");
    if (eyebrow) eyebrow.innerText = db.orgSettings.orgName ? db.orgSettings.orgName : "Digital Ledger";
  }

  /* =========================================================================
    FINANCIAL STATEMENT (Statement of Receipts and Disbursements)
    ========================================================================= */

  function formatDisplayDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  function formatStatement(htmlContent) {
      // Create a temporary div to parse HTML
      const div = document.createElement('div');
      div.innerHTML = htmlContent;

      // Replace <br> tags with newlines
      div.innerHTML = div.innerHTML.replace(/<br\s*\/?>/gi, '\n');

      // Get the plain text
      let text = div.innerText;

      // Optional: further formatting (e.g., aligning values)
      // For simplicity, you can process 'text' as needed here

      return text;
  }


function generateStatement() {
  // Defensive checks prevent crashes if date input elements are missing in the HTML layout
  const startVal = document.getElementById("stmt-start")?.value || "";
  const endVal = document.getElementById("stmt-end")?.value || "";

  const outputEl = document.getElementById("statement-output");
  if (!outputEl) {
    if (window.eveAlert) {
      window.eveAlert("Error: '#statement-output' container element not found in HTML template.", true);
    } else {
      alert("Error: statement-output container element is missing.");
    }
    return;
  }

  // Ensure cashbook transactions are safe to map and filter
  const transactionsList = (db.cashbook && Array.isArray(db.cashbook.transactions)) ? db.cashbook.transactions : [];

  // Strictly capture entries typed into the manual form card using isManualCashbookTxn()
  const all = [...transactionsList]
    .filter(t => isManualCashbookTxn(t) && !isRemittanceTxn(t)) 
    .sort((a, b) =>
      (a.date || "").localeCompare(b.date || "") || String(a.id).localeCompare(String(b.id))
    );

  const before = startVal ? all.filter(t => t.date < startVal) : [];
  const beginningBalance = round2(
    (db.cashbook.openingBalance || 0) +
    before.filter(t => t.type === "income").reduce((s, t) => s + (Number(t.amount) || 0), 0) -
    before.filter(t => t.type === "expense").reduce((s, t) => s + (Number(t.amount) || 0), 0)
  );

  const inRange = all.filter(t => {
    if (startVal && t.date < startVal) return false;
    if (endVal && t.date > endVal) return false;
    return true;
  });

  const incomeTxns = inRange.filter(t => t.type === "income");
  const expenseTxns = inRange.filter(t => t.type === "expense");

  const totalReceipts = round2(incomeTxns.reduce((s, t) => s + (Number(t.amount) || 0), 0));
  const totalDisbursements = round2(expenseTxns.reduce((s, t) => s + (Number(t.amount) || 0), 0));
  const endingBalance = round2(beginningBalance + totalReceipts - totalDisbursements);

  let statementReceipts = totalReceipts;
  let statementDisbursements = totalDisbursements;
  let statementBeginning = beginningBalance;
  let statementEnding = endingBalance;

  const periodLabel = (startVal || endVal)
    ? `${startVal ? formatDisplayDate(startVal) : 'Beginning'} to ${endVal ? formatDisplayDate(endVal) : 'Present'}`
    : "All Recorded Transactions";

  const org = db.orgSettings || {};

  // 🌟 FIX: prepended "\${t.date} — " directly before the description label text string
  const incomeRows = (() => {
    return incomeTxns.map(t => {
      const displayLabel = t.description || t.category || "Unnamed Income";
      const datePrefix = t.date ? `${t.date} — ` : "";
      return `<div class="statement-row"><span>${esc(datePrefix + displayLabel)}</span><span>${peso(t.amount)}</span></div>`;
    }).join("") || '<p class="note">No receipts recorded for this period.</p>';
  })();

  // 🌟 FIX: prepended "\${t.date} — " directly before the description label text string
  const expenseRows = (() => {
    return expenseTxns.map(t => {
      const displayLabel = t.description || t.category || "Unnamed Expense";
      const datePrefix = t.date ? `${t.date} — ` : "";
      return `<div class="statement-row"><span>${esc(datePrefix + displayLabel)}</span><span>${peso(t.amount)}</span></div>`;
    }).join("") || '<p class="note">No disbursements recorded for this period.</p>';
  })();

  // Render the structured report layout directly into the cleared output node container
  outputEl.innerHTML = `
    <div class="statement-print-area">
      <div class="statement-header">
        <h3>${esc(org.orgName || "Organization Name")}</h3>
        <p class="note">PUP Unisan Campus${org.schoolYear ? ' • S.Y. ' + esc(org.schoolYear) : ''}</p>
        <h4>STATEMENT OF RECEIPTS AND DISBURSEMENTS</h4>
        <p class="note">For the period: ${esc(periodLabel)}</p>
      </div>

      <div class="statement-row statement-subtotal"><span>Beginning Cash Balance</span><b>${peso(statementBeginning)}</b></div>

      <h4 style="margin-top:18px;">Receipts</h4>
      ${incomeRows}
      <div class="statement-row statement-subtotal"><span>Total Receipts</span><b style="color:var(--success)">${peso(statementReceipts)}</b></div>

      <h4 style="margin-top:18px;">Disbursements</h4>
      ${expenseRows}
      <div class="statement-row statement-subtotal"><span>Total Disbursements</span><b style="color:var(--danger)">${peso(statementDisbursements)}</b></div>

      <div class="statement-row statement-final"><span>Ending Cash Balance</span><b>${peso(statementEnding)}</b></div>

      <div class="statement-signatures">
        <div><p class="note">Prepared by:</p><p class="sig-line">${esc(org.treasurerName || '_______________________')}</p><p class="note">Treasurer</p></div>
        <div><p class="note">Noted by:</p><p class="sig-line">${esc(org.presidentName || '_______________________')}</p><p class="note">President / Adviser</p></div>
      </div>
      <p class="note" style="margin-top:16px; text-align:center;">Generated on ${new Date().toLocaleDateString()} via Treasurer Recorder</p>
    </div>
  `;

  if (typeof outputEl.scrollIntoView === "function") {
    outputEl.scrollIntoView({ behavior: "smooth" });
  }
}




  async function exportStatementText() {
    const area = document.querySelector(".statement-print-area");
    if (!area) return;
    const text = area.innerText;
    await exportFileCrossPlatform(text, `statement-${new Date().toISOString().slice(0, 10)}.txt`, "text/plain", "Export Statement");
  }

async function exportStatementImage() {
  const startVal = document.getElementById("stmt-start").value;
  const endVal = document.getElementById("stmt-end").value;
  const org = db.orgSettings || {};

  const all = [...db.cashbook.transactions].sort((a, b) =>
    (a.date || "").localeCompare(b.date || "") || String(a.id).localeCompare(String(b.id))
  );
  const before = startVal ? all.filter(t => t.date < startVal) : [];
  const beginningBalance = round2(
    (db.cashbook.openingBalance || 0) +
    before.filter(t => t.type === "income" || t.type === "remittance").reduce((s, t) => s + (Number(t.amount) || 0), 0) -
    before.filter(t => t.type === "expense").reduce((s, t) => s + (Number(t.amount) || 0), 0)
  );
  const inRange = all.filter(t => {
    if (startVal && t.date < startVal) return false;
    if (endVal && t.date > endVal) return false;
    return true;
  });
  const incomeTxns = inRange.filter(t => t.type === "income" || t.type === "remittance");
  const expenseTxns = inRange.filter(t => t.type === "expense");
  const incomeByCategory = {};
  incomeTxns.forEach(t => { incomeByCategory[t.category] = round2((incomeByCategory[t.category] || 0) + t.amount); });
  const expenseByCategory = {};
  expenseTxns.forEach(t => { expenseByCategory[t.category] = round2((expenseByCategory[t.category] || 0) + t.amount); });
  const totalReceipts = round2(incomeTxns.reduce((s, t) => s + (Number(t.amount) || 0), 0));
  const totalDisbursements = round2(expenseTxns.reduce((s, t) => s + (Number(t.amount) || 0), 0));
  const endingBalance = round2(beginningBalance + totalReceipts - totalDisbursements);

  // Keep this fullscreen statement in sync with the CASH ON HAND card when
  // showing the full, unfiltered period (see the same logic above).
  let statementReceipts = totalReceipts;
  let statementDisbursements = totalDisbursements;
  let statementBeginning = beginningBalance;
  let statementEnding = endingBalance;
  if (!startVal && !endVal && typeof computeCashbookTotals === 'function') {
    const cb = computeCashbookTotals();
    statementBeginning = cb.opening;
    statementReceipts = round2(cb.totalIncome + cb.totalRemits);
    statementDisbursements = cb.totalExpense;
    statementEnding = cb.cashOnHand;
  }

  const periodLabel = (startVal || endVal)
    ? `${startVal ? formatDisplayDate(startVal) : 'Beginning'} to ${endVal ? formatDisplayDate(endVal) : 'Present'}`
    : "All Recorded Transactions";

  const incomeRows = (() => {
    const rows = Object.keys(incomeByCategory).sort().map(c => {
      const displayCat = c === "Year Levels Payment" ? "All Year Levels Payment" : c;
      return `<div class="statement-row"><span>${esc(displayCat)}</span><span>${peso(incomeByCategory[c])}</span></div>`;
    });
    if (!startVal && !endVal && typeof getCollectionRemittanceTotals === 'function') {
      const pending = getCollectionRemittanceTotals().remainingCollected;
      if (pending > 0) {
        rows.push(`<div class="statement-row"><span>Collections Not Yet Remitted</span><span>${peso(pending)}</span></div>`);
      }
    }
    return rows.join("") || '<p class="note">No receipts recorded for this period.</p>';
  })();

  const expenseRows = Object.keys(expenseByCategory).sort().map(c =>
    `<div class="statement-row"><span>${esc(c)}</span><span>${peso(expenseByCategory[c])}</span></div>`
  ).join("") || '<p class="note">No disbursements recorded for this period.</p>';

  const html = `
    <div style="background:#fff; padding:32px 24px; max-width:720px; margin:0 auto; font-family:Inter,sans-serif; color:#1F2A24; min-height:100vh; box-sizing:border-box;">
      <div style="text-align:center; margin-bottom:18px; padding-bottom:12px; border-bottom:1.5px dashed #ddd;">
        <h3 style="font-size:17px; margin-bottom:4px; font-weight:bold;">${esc(org.orgName || "Organization Name")}</h3>
        <p style="font-size:12px; color:#6E7A72; margin-bottom:4px;">PUP Unisan Campus${org.schoolYear ? ' • S.Y. ' + esc(org.schoolYear) : ''}</p>
        <h4 style="font-size:14px; margin-bottom:4px; font-weight:bold;">STATEMENT OF RECEIPTS AND DISBURSEMENTS</h4>
        <p style="font-size:12px; color:#6E7A72;">For the period: ${esc(periodLabel)}</p>
      </div>

      <div style="display:flex; justify-content:space-between; padding:8px 0; font-size:14px; font-family:'IBM Plex Mono',monospace; border-top:1px solid #ddd; margin-top:2px; padding-top:10px; font-weight:600;">
        <span>Beginning Cash Balance</span><b>${peso(statementBeginning)}</b>
      </div>

      <h4 style="margin-top:20px; font-size:13px; font-weight:bold; color:#163F2D;">Receipts</h4>
      ${incomeRows}
      <div style="display:flex; justify-content:space-between; padding:8px 0; font-size:14px; font-family:'IBM Plex Mono',monospace; border-top:1px solid #ddd; margin-top:2px; padding-top:10px; font-weight:600;">
        <span>Total Receipts</span><b style="color:#2F7D53;">${peso(statementReceipts)}</b>
      </div>

      <h4 style="margin-top:20px; font-size:13px; font-weight:bold; color:#163F2D;">Disbursements</h4>
      ${expenseRows}
      <div style="display:flex; justify-content:space-between; padding:8px 0; font-size:14px; font-family:'IBM Plex Mono',monospace; border-top:1px solid #ddd; margin-top:2px; padding-top:10px; font-weight:600;">
        <span>Total Disbursements</span><b style="color:#B3423B;">${peso(statementDisbursements)}</b>
      </div>

      <div style="display:flex; justify-content:space-between; padding:8px 0; font-size:15px; font-family:'IBM Plex Mono',monospace; border-top:2px solid #1F5D42; margin-top:12px; padding-top:12px; font-weight:700;">
        <span>Ending Cash Balance</span><b>${peso(statementEnding)}</b>
      </div>

      <div style="display:flex; justify-content:space-between; margin-top:32px; gap:16px; text-align:center;">
        <div style="flex:1; min-width:0;">
          <p style="font-size:12px; color:#6E7A72; margin-bottom:4px;">Prepared by:</p>
          <p style="margin-top:24px; border-top:1px solid #1F2A24; padding-top:4px; font-weight:600; font-size:12px;">${esc(org.treasurerName || '_______________________')}</p>
          <p style="font-size:11px; color:#6E7A72;">Treasurer</p>
        </div>
        <div style="flex:1; min-width:0;">
          <p style="font-size:12px; color:#6E7A72; margin-bottom:4px;">Noted by:</p>
          <p style="margin-top:24px; border-top:1px solid #1F2A24; padding-top:4px; font-weight:600; font-size:12px;">${esc(org.presidentName || '_______________________')}</p>
          <p style="font-size:11px; color:#6E7A72;">President / Adviser</p>
        </div>
      </div>
      <p style="margin-top:18px; text-align:center; font-size:11px; color:#6E7A72;">Generated on ${new Date().toLocaleDateString()} via Treasurer Recorder</p>
    </div>
  `;

  // ── NATIVE SCREENSHOT PATH (Android) ──
  if (isAndroidApp()) {
    try {
      const plugins = window.Capacitor.Plugins || {};
      const { Screenshot, Filesystem, Share } = plugins;

      if (!Screenshot) {
        eveAlert("Screenshot plugin not found. Make sure @capawesome/capacitor-screenshot is installed and synced.", true);
        return;
      }

      // Create fullscreen overlay
      let overlay = document.getElementById('screenshot-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'screenshot-overlay';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.zIndex = '99999';
        overlay.style.background = '#ffffff';
        overlay.style.overflow = 'auto';
        overlay.style.display = 'none';
        document.body.appendChild(overlay);
      }
      overlay.innerHTML = html;
      overlay.style.display = 'block';

      // Let the WebView render it
      await new Promise(r => setTimeout(r, 600));

      // Take native screenshot
      const result = await Screenshot.take();

      // Hide overlay immediately
      overlay.style.display = 'none';
      overlay.innerHTML = '';

      if (!result || !result.uri) {
        throw new Error("Screenshot returned no image");
      }

      // ── FIX: Copy screenshot to app CACHE so Share plugin can read it ──
      const fileName = `statement-${Date.now()}.png`;
      let base64Data;

      // Try reading the screenshot file directly
      try {
        const readRes = await Filesystem.readFile({
          path: result.uri,
          encoding: 'base64'
        });
        base64Data = readRes.data;
      } catch (e1) {
        // If direct read fails, fetch it via the WebView
        const response = await fetch(result.uri);
        const blob = await response.blob();
        base64Data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }

      // Write to app cache (Share plugin can definitely access this)
      const writeResult = await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: "CACHE",
        encoding: "base64"
      });

      // Share using files array (required for images on Android)
      await Share.share({
        title: "Financial Statement",
        text: `Statement for ${org.orgName || 'Organization'} (${periodLabel})`,
        files: [writeResult.uri],
        dialogTitle: "Share Statement"
      });

    } catch (e) {
      eveAlert("Screenshot export failed: " + e.message, true);
    }
    return;
  }

  // ── DESKTOP FALLBACK (html2canvas via script tag) ──
  const container = document.createElement('div');
  container.innerHTML = html;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '720px';
  document.body.appendChild(container);

  try {
    if (!window.html2canvas) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    const canvas = await window.html2canvas(container, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false
    });

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `statement-${new Date().toISOString().slice(0,10)}.png`;
    link.click();
  } catch (e) {
    eveAlert("Desktop export failed: " + e.message, true);
  } finally {
    document.body.removeChild(container);
  }
}

function getCollectionRemittanceTotals() {
  let totalCollected = 0;
  let totalRemitted = 0;

  Object.values(db.categories || {}).forEach(category => {
    const collected = round2((category.records || []).reduce((sum, record) => {
      return sum + (Number(record.paid) || 0);
    }, 0));

    totalCollected += collected;
    if (category.remittanceStatus === "remitted") {
      totalRemitted += collected;
    }
  });

  totalCollected = round2(totalCollected);
  totalRemitted = Math.min(totalCollected, round2(totalRemitted));

  return {
    totalCollected,
    totalRemitted,
    remainingCollected: Math.max(0, round2(totalCollected - totalRemitted))
  };
}

function getCollectionTurnoverTotal() {
  return getCollectionRemittanceTotals().totalRemitted;
}

function getTotalCollectedAfterRemittance() {
  return getCollectionRemittanceTotals().remainingCollected;
}

function renderSummary() {
  const statusEl = document.getElementById("backup-status");
  const lastBackup = localStorage.getItem("lastBackupTime");
  if (statusEl) {
    if (!lastBackup) {
      statusEl.innerText = "⚠ You have never backed up your data yet.";
      statusEl.style.color = "#B3423B";
    } else {
      const days = Math.floor((Date.now() - parseInt(lastBackup, 10)) / (1000 * 60 * 60 * 24));
      if (days <= 0) {
        statusEl.innerText = "✓ Last backup: today";
        statusEl.style.color = "#2F7D53";
      } else if (days === 1) {
        statusEl.innerText = "Last backup: 1 day ago";
        statusEl.style.color = "#2F7D53";
      } else if (days <= 7) {
        statusEl.innerText = `Last backup: ${days} days ago`;
        statusEl.style.color = days <= 3 ? "#2F7D53" : "#B8872F";
      } else {
        statusEl.innerText = `⚠ Last backup: ${days} days ago — back up soon!`;
        statusEl.style.color = "#B3423B";
      }
    }
  }

  const metricsContainer = document.getElementById("summary-dashboard-metrics");
  if (metricsContainer) {
    const catsCount = Object.keys(db.categories || {}).length;
    const studsCount = (db.students || []).length;
    
    // 1. Calculate money inside collection categories.
    const collectionsPaidTotal = round2(Object.values(db.categories || {}).reduce((sum, c) =>
      sum + (c.records || []).reduce((categorySum, r) => categorySum + (Number(r.paid) || 0), 0), 0));
    let collectionsDueTotal = 0;
    Object.values(db.categories || {}).forEach(c => {
      collectionsDueTotal += (c.records || []).reduce((s, r) => s + (Number(r.due) || 0), 0);
    });

    // 2. Subtract collection turnovers so Total Collected reflects only funds
    //    that remain unremitted. This is recalculated after every toggle save.
    const totalTurnedOverRemittances = getCollectionTurnoverTotal();
    const grandTotalPaid = Math.max(0, round2(collectionsPaidTotal - totalTurnedOverRemittances));
    
    // 4. Recalculate remaining balance outstanding
    const grandTotalBalance = Math.max(0, round2(collectionsDueTotal - collectionsPaidTotal));

    // 5. Get the current Cash Book Balance to keep summary cards aligned
    const { cashOnHand } = typeof computeCashbookTotals === "function" 
      ? computeCashbookTotals() 
      : { cashOnHand: 0 };

    metricsContainer.innerHTML = `
      <div class="summary-card">
        <h4>TOTAL YEAR LEVELS</h4>
        <p>${studsCount}</p>
      </div>
      <div class="summary-card">
        <h4>ALL COLLECTION CATEGORIES</h4>
        <p>${catsCount}</p>
      </div>
      <div class="summary-card">
        <h4>TOTAL COLLECTED</h4>
        <p style="color:var(--success)">${peso(grandTotalPaid)}</p>
      </div>
      <div class="summary-card">
        <h4>TOTAL BALANCE</h4>
        <p style="color:var(--danger)">${peso(grandTotalBalance)}</p>
      </div>
      <div class="summary-card">
        <h4>CASH BOOK BALANCE</h4>
        <p>${peso(cashOnHand)}</p>
      </div>
      <div class="summary-card">
        <h4>ACTIVE PROJECTS</h4>
        <p>${db.projects ? db.projects.length : 0}</p>
      </div>
    `;
  }
}





function openBackupFullscreen() {
  const source = document.getElementById("backup-section") || document.getElementById("summary-section");
  const target = document.getElementById("backup-fullscreen-content");
  const overlay = document.getElementById("backup-fullscreen-overlay");
  if (!source || !target || !overlay) return;
  
  const clone = source.cloneNode(true);
  clone.querySelectorAll(".backup-fullscreen-trigger, .nav-menu, .eve-bot").forEach(el => el.remove());
  
  target.innerHTML = "";
  target.appendChild(clone);
  overlay.classList.remove("hidden");
}





function openBackupFullscreen() {
  const source = document.getElementById("summary-section");
  const target = document.getElementById("backup-fullscreen-content");
  const overlay = document.getElementById("backup-fullscreen-overlay");
  if (!source || !target || !overlay) return;
  
  const clone = source.cloneNode(true);
  
  // Remove nav menus and floating assistants cleanly
  clone.querySelectorAll(".backup-fullscreen-trigger, .nav-menu, .eve-bot").forEach(el => el.remove());
  
  // Clean up formatting but PRESERVE your essential backup control features
  clone.querySelectorAll("button, input, label").forEach(el => {
    // 💡 EXCEPTIONS: Do not remove elements if they are part of the backup status or the action tools
    if (
      el.closest("#backup-status") || 
      el.getAttribute("onclick")?.includes("exportBackup") ||
      el.getAttribute("onchange")?.includes("importBackup") ||
      el.getAttribute("onclick")?.includes("resetAllData") ||
      el.id === "backup-status"
    ) {
      return; // Leave these elements completely untouched!
    }
    el.remove();
  });
  
  target.innerHTML = clone.innerHTML;
  overlay.classList.remove("hidden");
}


  function closeBackupFullscreen() {
    document.getElementById("backup-fullscreen-overlay")?.classList.add("hidden");
  }

  function openStatementFullscreen() {
    const statement = document.querySelector("#statement-output .statement-print-area");
    const target = document.getElementById("statement-fullscreen-content");
    if (!statement || !target) return eveAlert("Generate the statement first.", true);
    target.innerHTML = statement.outerHTML;
    document.getElementById("statement-fullscreen-overlay")?.classList.remove("hidden");
  }

  function closeStatementFullscreen() {
    document.getElementById("statement-fullscreen-overlay")?.classList.add("hidden");
  }

  // ================= BACKUP / RESTORE =================
  function importBackup(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const imported = JSON.parse(e.target.result);
        if (!Array.isArray(imported.students) || typeof imported.categories !== "object" || imported.categories === null) {
          throw new Error("Invalid file");
        }
        if (confirm("This will REPLACE all current data with this backup. Continue?")) {
          db = imported;
          migrateDb();
          saveData();
          renderStudents();
          renderSummary();
          renderCashbookSummary();
          renderCashbookList();
          renderProjects();
          loadOrgSettingsForm();
          updateAppHeader();
          eveAlert("Backup restored!");
        }
      } catch (err) {
        eveAlert("Invalid backup file.", true);
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  }

  function resetAllData() {
    if (confirm("This will permanently erase ALL students, collections, cash book transactions, and projects. Continue?")) {
      if (confirm("Are you absolutely sure? This cannot be undone.")) {
        db = { students: [], categories: {} };
        migrateDb();
        saveData();
        renderStudents();
        renderSummary();
        renderCashbookSummary();
        renderCashbookList();
        renderProjects();
        loadOrgSettingsForm();
        updateAppHeader();
      }
    }
  }

// Initial render on page load
window.addEventListener("DOMContentLoaded", () => {
  checkMode();          // <-- NEW: mode must be checked first
  if (!getMode()) return; // Don't render until mode is chosen

  /* 🔗 DEFAULT HOME TAB: open on Records, not Backup */
  switchTab('inventory-section', document.getElementById('nav-inventory'));

  renderStudents();
  renderCategories();
  renderSummary();
  renderCashbookSummary();
  renderCashbookList();
  renderProjects();
  loadOrgSettingsForm();
  updateAppHeader();
  updateUndoRedoButtons();

  // 🌟 FIX: Defer the internal form text field baseline reset by a fraction 
  // so it doesn't cross-wire with your active tab initialization layouts
  setTimeout(() => {
    resetTxnForm();
  }, 20);
});



/* =========================================================================
   EVE SMART ASSISTANT — Idle Toggle + Alert Replacement
   ========================================================================= */
(function() {
  const nativeAlert = window.alert.bind(window);

  const eveBot      = document.getElementById('eveBot');
  const eveHead     = document.getElementById('eveHead');
  const speechBubble= document.getElementById('speechBubble');
  const msgEl       = document.getElementById('eveMsg');
  const actionsEl   = document.getElementById('eveActions');
  const allEyes     = document.querySelectorAll('.eve-eye');

  let isInteracting = false;
  let ambientTimer  = null;
  let bubbleTimer   = null;
  let msgQueue      = [];
  let msgIndex      = 0;
  let hasShownUrgent= false;
  let idleCycleTimer= null;
  let idleTipIndex  = 0;
  let idleCycleActive = true;
  let lastBubbleShow = 0;          // ← NEW: grace-period tracker
  const BUBBLE_GRACE_MS = 300;     // ← NEW

  const IDLE_TIPS = [
    `💡 Try Dark mode in the top bar!`,
    `💡 All data stays offline. Back it up regularly!`,
    `💡 Switch between Org and Class mode anytime.`,
    `💡 Am I annoying? Tap the green button below.`,
    `💡 Export CSVs from any collection for easy reporting.`,
    `💡 Set an Opening Balance in Cashbook for accurate statements.`,
    `💡 Deleting a classfund payment history also deletes its transaction.`,
    `💡 Tap a student's card in Records to edit their due or paid amount directly.`,
    `💡 Use the search box in any tab to filter long lists instantly.`,
    `💡 Link Cash Book transactions to Projects for auto-generated liquidation reports.`,
    `💡 In Class mode, set the weekly due and start date before recording payments.`,
    `💡 Forgot your PIN? Use your device's Activation Code to reset it safely.`,
    `💡 Add all students to a collection at once with the "Add All" button.`,
    `💡 Student payments recorded in Records automatically sync to the Cash Book.`,
    `💡 Generate a Financial Statement anytime from the Summary tab for GA or audit.`,
    `💡 Keep your backup JSON file safe — it contains all your records!`,
    `💡 Use OR / Voucher numbers in Cash Book for easier tracking during audits.`,
    `💡 Rename a collection anytime by opening it and tapping "Rename".`,
    `💡 Your data lives in this browser only — clearing cache will erase everything!`,
    `💡 The Activation Code locks this app to your device. It won't work on another phone.`,
    `💡 Switching from Org to Class mode relabels every button and header automatically.`,
    `💡 You can edit or delete any payment history entry — totals recalculate instantly.`,
    `💡 Projects let you track event budgets separately from your main Cash Book.`,
    `💡 The "Quick Pay" button inside a student's edit card logs payment without leaving the page.`,
    `💡 Class Fund tracks missed weeks automatically once you set a start date.`,
    `💡 You can print the Financial Statement directly — it hides the rest of the page automatically.`,
    `💡 The A-Z index on the right of Collections lets you jump to any letter instantly.`,
    `💡 Collection names are case-insensitive, so "Field Trip" and "field trip" are treated as the same.`,
    `💡 Tap any student name in the Database tab to see their balance across every collection.`
  ];

  const extremeGlances = [
    { x: 0, y: 22 }, { x: 0, y: -22 }, { x: -18, y: 0 }, { x: 18, y: 0 },
    { x: -14, y: -15 }, { x: 14, y: 15 }, { x: -14, y: 15 }, { x: 14, y: -15 }, { x: 0, y: 0 }
  ];
  let currentTransform = "translate(0px, 0px)";

  function ambientBehavior() {
    if (isInteracting) return;
    if (Math.random() < 0.25) {
      allEyes.forEach(eye => { eye.style.transform = currentTransform; eye.classList.add('blink'); });
      setTimeout(() => allEyes.forEach(eye => eye.classList.remove('blink')), 150);
    } else {
      const p = extremeGlances[Math.floor(Math.random() * extremeGlances.length)];
      currentTransform = `translate(${p.x}px, ${p.y}px)`;
      allEyes.forEach(eye => { eye.style.transform = currentTransform; });
    }
    ambientTimer = setTimeout(ambientBehavior, Math.random() * 500 + 600);
  }

  function triggerJump(reactionType) {
    if (isInteracting) return;
    isInteracting = true;
    clearTimeout(ambientTimer);
    allEyes.forEach(eye => eye.classList.remove('blink'));
    eveHead.classList.add('is-stretching');

    const reactionClass = reactionType === 'lookup' ? 'is-looking-up' : 'is-smiling';

    setTimeout(() => { eveHead.classList.add(reactionClass); }, 250);
    setTimeout(() => {
      eveHead.classList.remove('is-stretching', reactionClass);

      if (reactionType === 'lookup') {
        /* ---- "nevermind" side-to-side eye dart ---- */
        allEyes.forEach(eye => {
          eye.style.transform = '';
          eye.classList.add('is-neverminding');
        });
        setTimeout(() => {
          allEyes.forEach(eye => {
            eye.classList.remove('is-neverminding');
            eye.style.transform = '';
          });
          isInteracting = false;
          currentTransform = "translate(0px, 0px)";
          ambientBehavior();
        }, 500);
      } else {
        setTimeout(() => {
          isInteracting = false;
          currentTransform = "translate(0px, 0px)";
          ambientBehavior();
        }, 200);
      }
    }, 1200);
  }
  
  function buildQueue() {
    const queue = [];
    const mode = (typeof getMode === 'function') ? getMode() : '';
    const activePage = document.querySelector('.page:not(.hidden)');
    const tabId = activePage ? activePage.id : '';

    if (mode === 'class' && db.classFund && db.classFund.records && db.classFund.weeklyDue) {
      let missedCount = 0;
      Object.keys(db.classFund.records).forEach(name => {
        if (typeof getMissedWeeks === 'function' && getMissedWeeks(name) > 0) missedCount++;
      });
      if (missedCount > 0) {
        queue.push({ text: `⚠ ${missedCount} student(s) missed class fund payments!`, action: 'goClassFund', label: 'View' });
      }
    }

    if (mode === 'org' && typeof computeCashbookTotals === 'function') {
      const cb = computeCashbookTotals();
      if (cb.cashOnHand < 0) {
        queue.push({ text: `⚠ Cash balance is ${peso(cb.cashOnHand)}. Review expenses!`, action: 'goCashbook', label: 'Fix' });
      }
    }

    const lastBackup = localStorage.getItem('lastBackupTime');
    if (!lastBackup) {
      queue.push({ text: `💾 You haven't backed up yet. Protect your records!`, action: 'backup', label: 'Back Up' });
    } else {
      const days = Math.floor((Date.now() - parseInt(lastBackup)) / 86400000);
      if (days > 7) queue.push({ text: `💾 Last backup was ${days} days ago. Back up soon!`, action: 'backup', label: 'Back Up' });
    }

    if (tabId === 'database-section') {
      if (db.students.length === 0) queue.push({ text: `👋 Start by adding your first student or year level here.` });
      else queue.push({ text: `💡 Tap any student to see their balance across all collections.` });
    }
    else if (tabId === 'inventory-section') queue.push({ text: `📁 Browse collections A-Z. Tap one to add students or export CSV.` });
    else if (tabId === 'cashbook-section') {
      if (!db.cashbook.transactions.length) queue.push({ text: `💵 Log income & expenses to generate Financial Statements.` });
      else queue.push({ text: `💡 Link transactions to Projects for easier liquidation reports.` });
    }
    else if (tabId === 'classfund-section') {
      if (!db.classFund.startDate || !db.classFund.weeklyDue) queue.push({ text: `⚙️ Set weekly due & start date to begin tracking.` });
      else queue.push({ text: `💡 Tap a student card to expand and record their payment.` });
    }
    else if (tabId === 'summary-section') queue.push({ text: `📊 Generate Statements and export backups from here.` });

    return queue;
  }

  const ACTIONS = {
    goClassFund: () => { dismiss(); if (typeof switchTab === 'function') switchTab('classfund-section', document.getElementById('nav-classfund')); },
    goCashbook:  () => { dismiss(); if (typeof switchTab === 'function') switchTab('cashbook-section', document.getElementById('nav-cashbook')); },
    goDatabase:  () => { dismiss(); if (typeof switchTab === 'function') switchTab('database-section', document.getElementById('nav-students')); },
    goSummary:   () => { dismiss(); if (typeof switchTab === 'function') switchTab('summary-section', document.getElementById('nav-summary')); },
    backup:      () => { dismiss(); if (typeof exportBackup === 'function') exportBackup(); },
    exportCSV:   () => { dismiss(); if (typeof exportClassFundWeeklyCSV === 'function') exportClassFundWeeklyCSV(); }
  };

  function renderBubble(item) {
    if (!item || !msgEl || !speechBubble) return;
    lastBubbleShow = Date.now();                       // ← NEW
    msgEl.textContent = item.text;
    let html = '';
    if (item.action && ACTIONS[item.action]) {
      html += `<button class="eve-action-btn" onclick="EveAssistant.act('${item.action}')">${esc(item.label || 'Go')}</button>`;
    }
    
    if (actionsEl) actionsEl.innerHTML = html;
    speechBubble.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => dismiss(), 12000);
  }

  function show() {
    msgQueue = buildQueue();
    msgIndex = 0;
    if (msgQueue.length) renderBubble(msgQueue[0]);
  }

  function next() {
    if (!msgQueue.length) msgQueue = buildQueue();
    if (!msgQueue.length) return;
    msgIndex = (msgIndex + 1) % msgQueue.length;
    renderBubble(msgQueue[msgIndex]);
  }

function dismiss() {
  if (speechBubble) {
    speechBubble.classList.remove('show');
    speechBubble.classList.remove('alert-active');
  }
  clearTimeout(bubbleTimer);
  idleCycleTimer = null;
  
  /* ── FIX: reset EVE head so she never gets stuck smiling ── */
  if (eveHead) {
    eveHead.classList.remove('is-stretching', 'is-smiling');
    const overlay = document.getElementById("eve-inventory-overlay");
    if (overlay && !overlay.classList.contains("hidden")) {
      eveHead.classList.add('is-looking-inventory');
    }
  }
  
  if (idleCycleActive) idleCycleTimer = setTimeout(runIdleCycle, 10000);
}
  function checkUrgent() {
    msgQueue = buildQueue();
    const urgent = msgQueue.find(m => m.text && m.text.startsWith('⚠'));
    if (urgent && !hasShownUrgent) {
      msgIndex = msgQueue.indexOf(urgent);
      renderBubble(urgent);
      hasShownUrgent = true;
    }
  }

function runIdleCycle() {
  idleCycleTimer = null;
  // Idle tips disabled — EVE only speaks when tapped or on alerts
}

  function pauseIdleCycle() {
    clearTimeout(idleCycleTimer);
    idleCycleTimer = null;
  }

function toggleEveIdle() {
  idleCycleActive = !idleCycleActive;
  const btn = document.getElementById('eve-idle-toggle');
  const zipper = document.getElementById('eveZipper');
  const bot   = document.getElementById('eveBot');   // ← ADD THIS LINE

  if (btn) {
    btn.classList.toggle('stopped', !idleCycleActive);
    btn.classList.toggle('running', idleCycleActive);
    btn.title = idleCycleActive ? 'Idle tips running — tap to stop' : 'Idle tips paused — tap to resume';
  }

  /* ── NEW: shrink EVE into the button or pop her back out ── */
  if (bot) {
    bot.classList.toggle('eve-silenced', !idleCycleActive);
  }

  /* ---- brief zipper flash, then back to normal ---- */
  if (zipper) {
    zipper.classList.remove('zipping', 'unzipping');
    void zipper.offsetWidth; // force reflow
    zipper.classList.add(!idleCycleActive ? 'zipping' : 'unzipping');
    setTimeout(() => {
      zipper.classList.remove('zipping', 'unzipping');
    }, 600);
  }

  if (idleCycleActive) {
    runIdleCycle();
  } else {
    clearTimeout(idleCycleTimer);
    idleCycleTimer = null;
    if (speechBubble && speechBubble.classList.contains('show') && !msgQueue[msgIndex]?.action) dismiss();
  }
}
/* --- showMsg: displays alerts through EVE's bubble --- */
function showMsg(msg, isError = false, reaction = 'lookup', duration = 4000) {
  clearTimeout(idleCycleTimer);
  idleCycleTimer = null;
  lastBubbleShow = Date.now();

  triggerJump(reaction);   // ← was hardcoded 'lookup'

  if (msgEl) msgEl.textContent = msg;
  if (actionsEl) actionsEl.innerHTML = '';
  if (speechBubble) {
    speechBubble.classList.add('show');
    if (isError) speechBubble.classList.add('alert-active');
    else speechBubble.classList.remove('alert-active');
  }
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => dismiss(), Math.max(1000, Number(duration) || 4000));
}

  /* --- eveAlert: replaces native eveAlert() --- */
/* --- eveAlert: replaces native alert() --- */
function eveAlert(msg, isError = false) {
  if (speechBubble && msgEl) {
    showMsg(msg, isError, isError ? 'lookup' : 'smile');  // ← CHANGED
  } else {
    nativeAlert(msg);
  }
}

  /* --- Attach toggle button listener --- */
  const idleToggleBtn = document.getElementById('eve-idle-toggle');
  if (idleToggleBtn) {
    idleToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleEveIdle();
    });
  }

  /* --- Head tap --- */
  if (eveHead) {
    eveHead.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      pauseIdleCycle();
      if (speechBubble && speechBubble.classList.contains('show')) dismiss();

      const overlay = document.getElementById("eve-inventory-overlay");
      if (overlay && !overlay.classList.contains("hidden")) {
        eveInventoryTapInteraction();
      } else {
        openEveInventory();
      }
    });
    eveHead.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      pauseIdleCycle();
      if (speechBubble && speechBubble.classList.contains('show')) dismiss();

      const overlay = document.getElementById("eve-inventory-overlay");
      if (overlay && !overlay.classList.contains("hidden")) {
        eveInventoryTapInteraction();
      } else {
        openEveInventory();
      }
    }, { passive: false });
  }

  /* --- Click outside to dismiss --- */
  document.addEventListener('click', (e) => {
    if (speechBubble && speechBubble.classList.contains('show') && !speechBubble.contains(e.target) && !eveHead.contains(e.target) && !e.target.closest('#eve-idle-toggle')) {
      if (Date.now() - lastBubbleShow < BUBBLE_GRACE_MS) return;   // ← NEW
      dismiss();
    }
  });

  /* --- Hook tab switches --- */
  if (typeof switchTab === 'function') {
    const _origSwitchTab = switchTab;
    window.switchTab = function(id, btn) {
      _origSwitchTab(id, btn);
      setTimeout(() => { msgQueue = buildQueue(); }, 300);
    };
  }

      window.EveAssistant = {
    show, next, dismiss, checkUrgent, toggleEveIdle, showMsg,
    showTip: (msg) => showMsg(msg, false, 'lookup', 15000),
    react: (mode) => triggerJump(mode),   // ← this line
    act: (key) => { if (ACTIONS[key]) ACTIONS[key](); }
  };

  /* --- Expose eveAlert globally --- */
  window.eveAlert = eveAlert;

  /* --- Inventory-open tap: Wall-E easter egg --- */
function eveInventoryTapInteraction() {
  if (!eveHead || !speechBubble || !msgEl) return;

  clearTimeout(bubbleTimer);

  // Temporarily remove inventory-look so it doesn't fight the smile transform
  eveHead.classList.remove('is-looking-inventory');

  // Reset any previous animation
  eveHead.classList.remove('is-stretching', 'is-smiling');
  void eveHead.offsetWidth; // force reflow

  // Stretch then smile
  eveHead.classList.add('is-stretching');
  setTimeout(() => {
    eveHead.classList.add('is-smiling');
  }, 250);

  // Show message
  msgEl.textContent = "tap the CLOSE button above to close.";
  if (actionsEl) actionsEl.innerHTML = '';
  speechBubble.classList.remove('alert-active');
  speechBubble.classList.add('show');

  // Auto-dismiss after 5s
  bubbleTimer = setTimeout(() => {
    dismiss();
    eveHead.classList.remove('is-stretching', 'is-smiling');
    // Restore inventory look if still open
    const overlay = document.getElementById("eve-inventory-overlay");
    if (overlay && !overlay.classList.contains("hidden")) {
      eveHead.classList.add('is-looking-inventory');
    }
  }, 5000);
}

  /* --- Ignition --- */
function initEve() {
  if (eveHead && speechBubble) {
    ambientBehavior();
    setTimeout(checkUrgent, 2500);
    // setTimeout(runIdleCycle, 10000);  // ← REMOVED: no more auto tips
  }
}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEve);
  } else {
    initEve();
  }
})();



/* ═══════════════════════════════════════════════════════════════
   EVE HEX INVENTORY LOGIC
   ═══════════════════════════════════════════════════════════════ */
let eveBlinkInterval = null;
let calcExpression = "";

function openEveInventory() {
  const overlay = document.getElementById("eve-inventory-overlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");

  // EVE looks toward lower-right where the hexes appear
  const head = document.getElementById("eveHead");
  if (head) head.classList.add("is-looking-inventory");

  // Continuous blink so she doesn't look like a statue
  eveBlinkInterval = setInterval(() => {
    document.querySelectorAll(".eve-eye").forEach(eye => {
      eye.classList.add("blink");
      setTimeout(() => eye.classList.remove("blink"), 140);
    });
  }, 2200);

  openEveGuide(); // default view
}


function _hideAllInventoryViews() {
  const ids = ['eve-calc-view','eve-guide-view','eve-logs-view','eve-notes-view','notes-plus-btn'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

function openEveCalc() {
  _hideAllInventoryViews();
  document.getElementById("eve-calc-view").classList.remove("hidden");

  const head = document.getElementById("eveHead");
  if (head) {
    head.classList.remove('is-stretching', 'is-smiling');
    head.classList.add('is-looking-inventory');
  }
}

function openEveGuide() {
  _hideAllInventoryViews();
  document.getElementById("eve-guide-view").classList.remove("hidden");

  const head = document.getElementById("eveHead");
  if (head) {
    head.classList.remove('is-stretching', 'is-smiling');
    head.classList.add('is-looking-inventory');
  }
  renderEveGuide();
}

function closeEveInventory() {
  const overlay = document.getElementById("eve-inventory-overlay");
  if (overlay) overlay.classList.add("hidden");

  const head = document.getElementById("eveHead");
  if (head) head.classList.remove("is-looking-inventory");

  if (eveBlinkInterval) {
    clearInterval(eveBlinkInterval);
    eveBlinkInterval = null;
  }
  // Hide all inner views so it's fresh next time
  _hideAllInventoryViews();
}
function renderEveGuide() {
  const box = document.getElementById("eve-guide-view");
  const mode = (typeof isOrg === 'function' && isOrg()) ? "org" : "class";

  const orgHTML = `
    <div style="width:100%;">

      <div class="eve-guide-section">
        <h4>➕ Add Tab</h4>
        <p><b>Add Collection Category</b> — Enter a collection name (e.g. "Newsette Fee") and the default amount every year level must pay. Tap <b>Add Collection</b> to create the bucket. This does not enroll year levels yet; it only creates the category.</p>
        <p><b>Record A Payment</b> — Use the searchable dropdowns to pick an existing <b>Collection</b> and a <b>Year Level</b> from your permanent database. Set the <b>Payment Date</b>, add an optional <b>Note</b>, enter the <b>Amount Paying Now</b>, then tap <b>Record Payment</b>. The Year Level is auto-enrolled into that collection if they weren't already, and the payment instantly syncs to your <b>Cash Book</b> as income.</p>
        <p class="note" style="margin-top:6px;">💡 Year Levels must be added permanently in the <b>Year Level</b> tab before they appear in these dropdowns.</p>
      </div>

      <div class="eve-guide-section">
        <h4>🎓 Year Level Tab</h4>
        <p><b>Add Year Level (Permanent)</b> — Type a year-level name such as <b>BSIT 2</b> and tap <b>Add Year Level</b>. The year level becomes available throughout the organization records.</p>
        <p><b>Year Level Database</b> — Each card shows the year-level name and number of named students. Tap a card to open its year-level profile, then use <b>Open Students Database</b> to manage the named roster.</p>
        <p><b>Students Database</b> — Search the roster, add one or many names, or remove a student. The list is alphabetical and intentionally does not show individual paid/unpaid status or a per-student View Profile button, avoiding confusion between roster membership and collection payment records.</p>
        <p class="note" style="margin-top:6px;">💡 Organization mode uses named student rosters inside each year level. Class mode instead stores individual students directly in the main Student Database.</p>
      </div>

      <div class="eve-guide-section">
        <h4>📁 Records Tab</h4>
        <p><b>Collections A-Z</b> — All collection categories sorted alphabetically. Tap a letter in the right-side alpha index to jump instantly. Tap a collection card to open its detail view.</p>
        <p><b>Collection Detail</b> — Header shows the collection name. The toolbar has three actions:
          <br>• <b>+ Add All Year Level</b> — Bulk-enroll Year Level from the database who aren't in this collection yet.
          <br>• <b>Rename</b> — Change the collection name without losing data.
          <br>• <b>Export CSV</b> — Download a spreadsheet of all Year Level, dues, paid amounts, balances, and statuses.
        </p>
        <p><b>Item Summary</b> — Live totals: Collected, Expected, and Remaining Balance for the whole collection.</p>
        <p><b>Year Level Rows</b> — Tap a row to open the organization edit view. Change the <b>Amount per Student</b>, review payment history, and save the collection record. Organization editing also provides <b>+ Add All Students</b>, which opens a searchable picker for the year-level database, and <b>Open Student Bucket</b>.</p>
        <p><b>Student Bucket</b> — The bucket is separate from the collection total transaction so individual roster changes do not overwrite the year-level payment record. Students start with <b>Status: Paid</b>. Use the status button to switch between Paid and Unpaid, search or filter the list, and use <b>X</b> to remove a student. Both status changes and removals require confirmation.</p>
        <p><b>Payment History</b> — Every collection payment remains listed separately. Use <b>EDIT</b> or <b>DEL</b> on a history entry when needed. The collection record can be removed without deleting the year level or its student database.</p>
      </div>

      <div class="eve-guide-section">
        <h4>🧾 Year-Level Payments</h4>
        <p>Open a year-level record to edit its <b>Amount per Student</b>. Use the <b>Add Payment</b> fields to enter the payment amount, date, and note. Every payment appears in the year level's history and remains separate from the student bucket.</p>
        <p>Use <b>DEL</b> beside a history entry to remove an incorrect log. The record total recalculates automatically, and organization payments remain synchronized with the Cash Book.</p>
      </div>

      <div class="eve-guide-section">
        <h4>💵 Cashbook Tab</h4>
        <p><b>Summary Cards</b> — Opening Balance, Total Income, Total Expenses, and Cash On Hand. These update live as you add transactions.</p>
        <p><b>Set Opening Balance</b> — Declare how much cash you started with so the running balance is accurate.</p>
        <p><b>Projects & Events</b> — Switch to the project tracker where you can budget and liquidate per-event finances separately from the general fund.</p>
        <p><b>Record Transaction</b> — Toggle between <b>Income</b> and <b>Expense</b>. Fields include:
          <br>• <b>Date</b> — transaction date.
          <br>• <b>OR / Voucher No.</b> — for audit trails (optional).
          <br>• <b>Category</b> — pre-set list (Membership Dues, Event Income, Supplies, Food, etc.).
          <br>• <b>Description</b> — what the transaction is for.
          <br>• <b>Amount</b> — numeric value.
          <br>• <b>Link to Project/Event</b> — optional; ties this entry to a project for liquidation reports.
          <br>• <b>Notes</b> — extra details.
          <br>Tap <b>Save Transaction</b> to log it. If you tapped a ledger row to edit, <b>Cancel Edit</b> and <b>Delete This Transaction</b> appear instead.
        </p>
        <p><b>Cash Book Ledger</b> — Chronological list with a running balance on every row. Use the <b>Search</b> and <b>Type Filter</b> (All / Income / Expense) to narrow results. Tap any row to load it back into the form for editing. <b>Export CSV</b> downloads the full ledger.</p>
        <p><b>Projects & Events view</b> — Add a project name and optional budget. The list shows Budget, Spent, Income Raised, and Remaining. Tap a project to see every linked transaction, or tap <b>X</b> to delete the project (linked transactions return to the general fund).</p>
      </div>

      <div class="eve-guide-section">
        <h4>⇄ Transfer Funds</h4>
        <p>Inside any collection's detail view, tap <b>⇄ Transfer</b> to move money from that collection into another. This is useful when you need to reallocate collected funds (e.g., moving leftover money from one project to another, or sending pooled contributions to a central remittance collection).</p>
        <p>Each transfer is logged with:
          <br>• <b>Date</b> — when the transfer happened.
          <br>• <b>From / To</b> — source and destination collections.
          <br>• <b>Amount</b> — how much was moved.
          <br>• <b>Note</b> — optional reason (e.g., "Remittance completion").
        </p>
        <p>The collection's <b>Net after transfers</b> is shown in the summary bar at the top of the detail view. A full transfer history also appears at the bottom of every collection, showing every incoming and outgoing movement with +/− indicators and full dates.</p>
        <p class="note" style="margin-top:6px;">💡 You cannot transfer more than the net available balance (total paid in minus previous transfers out plus transfers in). Transfers are permanent and reflected instantly across both collections.</p>
      </div>

      <div class="eve-guide-section">
        <h4>⇄ Transfer Funds</h4>
        <p>Inside any collection's detail view, tap <b>⇄ Transfer</b> to move collected money from that collection into another. This is helpful when reallocating class funds between different fee categories (e.g., moving excess field-trip money into the graduation fund).</p>
        <p>Every transfer records:
          <br>• <b>Date</b> — when the transfer occurred.
          <br>• <b>From / To</b> — the source and destination collections.
          <br>• <b>Amount</b> — the exact sum moved.
          <br>• <b>Note</b> — optional explanation.
        </p>
        <p>A complete transaction log appears at the bottom of each collection view, listing all incoming (+) and outgoing (−) transfers with full dates and notes.</p>
        <p class="note" style="margin-top:6px;">💡 Transfers are limited to the collection's net available balance and are saved permanently in your backup.</p>
      </div>

      <div class="eve-guide-section">
        <h4>📊 Summary Tab</h4>
        <p><b>Overview Cards</b> — At-a-glance stats: Total Year Levels, Collection Categories, Total Collected, Total Unpaid Balances, Cash Book Balance, and Active Projects.</p>
        <p><b>Collections Breakdown</b> — Visual progress bars showing collection completion (paid vs. expected).</p>
        <p><b>Organization Info</b> — Fill in Organization Name, Treasurer Name, President / Adviser Name, and School Year. Tap <b>Save</b>. These names auto-fill the printed Financial Statement.</p>
        <p><b>Financial Statement</b> — Pick a <b>Start Date</b> and <b>End Date</b>, then tap <b>Generate Statement</b>. It produces a <b>Statement of Receipts and Disbursements</b> with Beginning Balance, categorized Receipts, Total Receipts, categorized Disbursements, Total Disbursements, Ending Balance, and signature lines. You can <b>Export as Text</b> or <b>Export as Image</b> for printing or submission.</p>
        <p><b>Backup Tab</b> — <b>Export Backup (JSON)</b> saves the complete organization database, including year levels, named students, collections, payments, student buckets, Cash Book entries, projects, settings, and history. <b>Import Backup</b> restores a saved file and replaces the current data, so verify the file before confirming. The tab shows the last backup time. <b>Reset All Data</b> permanently clears the app only after confirmation.</p>
      </div>

    </div>
  `;

  const classHTML = `
    <div style="max-width:640px; margin:0 auto;">

      <div class="eve-guide-section">
        <h4>➕ Add Tab</h4>
        <p><b>Add Collection Category</b> — Enter a collection name (e.g. "Field Trip Fee") and the default amount due per student. Tap <b>Add Collection</b> to create the category bucket.</p>
        <p><b>Record A Payment</b> — Select a <b>Collection</b> and a <b>Student</b> from the searchable dropdowns. Set the <b>Payment Date</b>, add an optional <b>Note</b>, enter the <b>Amount Paying Now</b>, then tap <b>Record Payment</b>. The student is auto-enrolled in that collection if they weren't already, and the payment is recorded in the class ledger.</p>
        <p class="note" style="margin-top:6px;">💡 Students must be added permanently in the <b>Students</b> tab before they appear in these dropdowns.</p>
      </div>

      <div class="eve-guide-section">
        <h4>🎓 Students Tab</h4>
        <p><b>Add Student (Permanent)</b> — Type the student's full name (e.g. "Juan Dela Cruz") and tap <b>Add Student</b>. This adds them to the master roster so they can be selected in collections and the Class Fund.</p>
        <p><b>Student Database</b> — Searchable list of all students. The count badge shows total enrolled. Tap any card to open their <b>Profile</b>.</p>
        <p><b>Student Profile</b> — Displays a summary grid (Total Due, Total Paid, Overall Balance) and a breakdown of every collection that student is part of, showing paid/due amounts and status: <span style="color:var(--success)">PAID</span>, <span style="color:var(--warning)">PARTIAL</span>, <span style="color:var(--danger)">UNPAID</span>, or <span style="color:var(--info)">OVERPAID</span>.</p>
      </div>

      <div class="eve-guide-section">
        <h4>📁 Records Tab</h4>
        <p><b>Collections A-Z</b> — All class collections sorted alphabetically. Use the right-side letter index to jump quickly. Tap a collection to manage it.</p>
        <p><b>Collection Detail</b> — Shows the collection name and three toolbar actions:
          <br>• <b>+ Add All Students</b> — Bulk-enroll every student in the database who isn't already in this collection.
          <br>• <b>Rename</b> — Change the collection name while keeping all records.
          <br>• <b>Export CSV</b> — Download a report of all students, dues, paid amounts, balances, and payment statuses.
        </p>
        <p><b>Item Summary</b> — Live totals for the entire collection: Collected, Expected, and Balance.</p>
        <p><b>Student Rows</b> — Tap a student to open the blurred <b>Edit Record</b> modal. Class mode shows <b>Amount Due</b>, <b>Total Paid</b>, and payment history for that student only. Use <b>Add Payment</b> to enter an amount, date, and note, use <b>DEL</b> to remove an incorrect history log, then save or cancel the edit. Organization-only student bucket controls are not shown in Class mode.</p>
      </div>

      <div class="eve-guide-section">
        <h4>⚡ Quick Pay</h4>
        <p>Quick Pay is a collection-level batch action, not part of the individual student editor. Use its searchable picker to select enrolled students, use Select All or Deselect All, enter one date, amount, and optional note, then confirm the payment.</p>
        <p>Each selected student receives an individual payment-history entry. The student editor itself only changes that student's Amount Due, Total Paid, and history.</p>
      </div>

      <div class="eve-guide-section">
        <h4>💰 Class Fund Tab</h4>
        <p><b>Settings</b> — Enter the <b>Weekly Due</b> amount (e.g. ₱20) and the <b>Collection Start Date</b>, then tap <b>Save Settings</b>. The app calculates how many weeks have passed and how much each student should have paid.</p>
        <p><b>Summary Cards</b> — Total Collected, Total Expenses, Net Balance, and number of Enrolled students.</p>
        <p><b>Missed Payment Alert</b> — If any student is behind, a red banner shows the total missed weeks across the class and the total unpaid balance.</p>
        <p><b>Toolbar</b> — <b>+ Add All Students</b> enrolls the entire database into Class Fund. <b>Reset Class Fund</b> clears all payments, expenses, and enrollments. <b>Export Weekly CSV</b> generates a per-week payment status sheet.</p>
        <p><b>Record Expense</b> — Log what the class fund was spent on (supplies, printing, food, etc.). Enter date, description, amount, and an optional note. Expenses deduct from the Net Balance.</p>
        <p><b>Student Collections</b> — Each student appears as a card showing paid/expected, missed weeks, last payment date, and a status badge. Tap a card to expand it:
          <br>• A <b>progress bar</b> shows completion.
          <br>• <b>Payment inputs</b> (date, amount, note) let you record new weekly payments.
          <br>• <b>Payment History</b> appears below with EDIT and DEL actions.
          <br>• <b>Remove from Class Fund</b> deletes that student's tracking and history.
        </p>
        <p><b>Class Fund Ledger</b> — A complete running-balance log of all income (student payments) and expenses. Tap any transaction to open a full-screen editor where you can change the date, amount, description, and note, or delete the entry entirely.</p>
      </div>

      <div class="eve-guide-section">
        <h4>📊 Summary Tab</h4>
        <p><b>Overview Cards</b> — Total Students, Collection Categories, Total Collected, Total Unpaid Balances, and Expected.</p>
        <p><b>Collections Breakdown</b> — Visual progress bars for each collection showing how much has been collected versus the total expected.</p>
        <p><b>Backup Tab</b> — <b>Export Backup (JSON)</b> saves students, collections, payment histories, Class Fund data, Cash Book entries, projects, settings, and history. <b>Import Backup</b> restores a saved JSON file and replaces the current data, so verify the file before confirming. The tab shows the last backup time. <b>Reset All Data</b> permanently wipes the app only after confirmation.</p>
        <p class="note" style="margin-top:6px;">💡 Class mode hides the Organization Info and Financial Statement sections because those are designed for org-wide GA/audit reporting.</p>
      </div>

    </div>
  `;

  box.innerHTML = (mode === "org") ? orgHTML : classHTML;
}


function renderEveSummary() {
  const box = document.getElementById("eve-summary-view");
  if (!box) return;

  const mode = (typeof isOrg === 'function' && isOrg()) ? "org" : "class";
  const cats = Object.keys(db.categories || {}).sort((a, b) => a.localeCompare(b));
  const collectionTotals = cats.map(category => {
    const records = Array.isArray(db.categories[category]?.records) ? db.categories[category].records : [];
    const due = round2(records.reduce((sum, record) => sum + (Number(record.due) || 0), 0));
    const paid = round2(records.reduce((sum, record) => sum + (Number(record.paid) || 0), 0));
    return { category, records, due, paid, balance: round2(due - paid) };
  });
  const totalDue = round2(collectionTotals.reduce((sum, item) => sum + item.due, 0));
  const totalPaid = round2(collectionTotals.reduce((sum, item) => sum + item.paid, 0));
  // Total Collected must match the main overview and exclude collections already remitted.
  const totalCollectedAfterRemittance = getCollectionRemittanceTotals().remainingCollected;
  const unpaidBalance = Math.max(0, round2(totalDue - totalPaid));

  let html = '<div style="width:100%;">';

  /* ═══════ SUMMARY SECTION ═══════ */
  html += `<div class="eve-guide-section" style="border-left:3px solid var(--accent);">`;
  html += `<h4 style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">`;
  html += `<span class="eve-summary-badge" style="background:var(--accent);">Remittance</span> Overview</h4>`;
  html += `<div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-bottom:12px;">`;
  html += `<div class="eve-summary-card"><h4>Total ${esc(lbl("Year Levels"))}</h4><p>${db.students.length}</p></div>`;
  html += `<div class="eve-summary-card"><h4>All Collection Categories</h4><p>${cats.length}</p></div>`;
  html += `<div class="eve-summary-card"><h4>Total Collected</h4><p style="color:var(--success);">${peso(totalCollectedAfterRemittance)}</p></div>`;
  html += `<div class="eve-summary-card"><h4>Total Balance</h4><p style="color:var(--danger);">${peso(unpaidBalance)}</p></div>`;
  if (mode === "org" && typeof computeCashbookTotals === 'function') {
    html += `<div class="eve-summary-card"><h4>Expected Amount</h4><p>${peso(totalDue)}</p></div>`;
    html += `<div class="eve-summary-card"><h4>Active Projects</h4><p>${db.projects.length}</p></div>`;
  } else if (mode === "class") {
    const classRecords = Object.values(db.categories || {}).flatMap(category => Array.isArray(category.records) ? category.records : []);
    const totalExpected = round2(classRecords.reduce((sum, record) => sum + (Number(record.due) || 0), 0));

    html += `<div class="eve-summary-card" style="grid-column: span 2;"><h4>Expected</h4><p>${peso(totalExpected)}</p></div>`;
  }
  html += `</div></div>`;
  /* ═══════ CASHBOOK SECTION (Org only) ═══════ */
  if (mode === "org" && typeof computeCashbookTotals === 'function') {
    const cb = computeCashbookTotals();
    html += `<div class="eve-guide-section" style="border-left:3px solid var(--success);">`;
    html += `<h4 style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">`;
    html += `<span class="eve-summary-badge" style="background:var(--success);">Income &amp; Expenses</span> Ledger</h4>`;
    html += `<div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-bottom:12px;">`;
    html += `<div class="eve-summary-card display-only"><h4>Opening Balance</h4><p>${peso(cb.opening)}</p></div>`;
    html += `<div class="eve-summary-card"><h4>Total Income</h4><p style="color:var(--success);">${peso(cb.totalIncome)}</p></div>`;
    html += `<div class="eve-summary-card"><h4>Total Expenses</h4><p style="color:var(--danger);">${peso(cb.totalExpense)}</p></div>`;
    html += `<div class="eve-summary-card"><h4>Cash On Hand</h4><p style="color:${cb.cashOnHand < 0 ? 'var(--danger)' : 'var(--ink, #1F2A24)'};">${peso(cb.cashOnHand)}</p></div>`;
    html += `</div></div>`;
  }

  /* ═══════ CLASS FUND SECTION (Class only) ═══════ */
  if (mode === "class") {
    const cf = db.classFund || {};
    const weekly = cf.weeklyDue || 0;
    const currentWeek = getExpectedWeeks(cf.startDate);
    const allNames = Object.keys(cf.records || {}).sort();
    let cfPaid = 0, cfExpected = 0, missed = 0;
    allNames.forEach(n => {
      cfPaid += cf.records[n].paid || 0;
      cfExpected += getClassFundExpected(n);
      missed += getMissedWeeks(n);
    });
    const cfExp = round2((cf.transactions || []).filter(t => t.type === "expense").reduce((s, t) => s + (Number(t.amount) || 0), 0));
    const net = round2(cfPaid - cfExp);

    html += `<div class="eve-guide-section" style="border-left:3px solid var(--warning);">`;
    html += `<h4 style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">`;
    html += `<span class="eve-summary-badge" style="background:var(--warning); color:#1F2A24;">Class Fund</span> Weekly Tracker</h4>`;
    html += `<div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-bottom:12px;">`;
    html += `<div class="eve-summary-card"><h4>Weekly Due</h4><p>${peso(weekly)}</p></div>`;
    html += `<div class="eve-summary-card"><h4>Current Week</h4><p>${cf.startDate ? 'Week ' + currentWeek : '—'}</p></div>`;
    html += `<div class="eve-summary-card"><h4>Total Collected</h4><p style="color:var(--success);">${peso(cfPaid)}</p></div>`;
    html += `<div class="eve-summary-card"><h4>Total Expenses</h4><p style="color:var(--danger);">${peso(cfExp)}</p></div>`;
    html += `<div class="eve-summary-card"><h4>Net Balance</h4><p style="color:${net < 0 ? 'var(--danger)' : 'var(--ink, #1F2A24)'};">${peso(net)}</p></div>`;
    html += `<div class="eve-summary-card"><h4>Enrolled</h4><p>${allNames.length}</p></div>`;
    html += `</div>`;

    if (missed > 0) {
      html += `<div style="background:linear-gradient(135deg, rgba(179,66,59,0.12), rgba(184,135,47,0.06)); border:1.5px dashed var(--danger); border-radius:var(--radius); padding:10px; text-align:center; margin-bottom:12px;">`;
      html += `<p style="font-family:'IBM Plex Mono',monospace; font-size:16px; font-weight:700; color:var(--danger); margin:0;">${missed} total missed week(s)</p>`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  /* ═══════ COLLECTIONS BREAKDOWN ═══════ */
  if (cats.length > 0) {
    html += `<div class="eve-guide-section" style="border-left:3px solid var(--accent-2);">`;
    html += `<h4 style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">`;
    html += `<span class="eve-summary-badge" style="background:var(--accent-2);">Collections</span> All Categories</h4>`;
    html += `<div style="display:flex; flex-direction:column; gap:8px;">`;
    cats.forEach(cat => {
      const c = db.categories[cat];
      const records = Array.isArray(c?.records) ? c.records : [];
      const due = records.reduce((s, r) => s + (Number(r.due) || 0), 0);
      const paid = records.reduce((s, r) => s + (Number(r.paid) || 0), 0);
      const paidStudents = records.filter(r => (Number(r.paid) || 0) >= (Number(r.due) || 0) && (Number(r.due) || 0) > 0).length;
      const partialStudents = records.filter(r => (Number(r.paid) || 0) > 0 && (Number(r.paid) || 0) < (Number(r.due) || 0)).length;
      const unpaidStudents = records.filter(r => (Number(r.paid) || 0) <= 0 && (Number(r.due) || 0) > 0).length;
      const balance = round2(due - paid);
      const pct = due > 0 ? Math.min(100, (paid / due) * 100) : 0;
      const color = balance > 0 ? 'var(--danger)' : 'var(--success)';
      html += `<div style="padding:10px 12px; background:rgba(255,255,255,0.03); border:1px solid rgba(233,240,235,0.08); border-radius:var(--radius-sm);">`;
      html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">`;
      html += `<b style="font-size:13px; color:var(--ink, #1F2A24);">${esc(cat)}</b>`;
      html += `<span style="font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:600; color:${color};">${peso(paid)} / ${peso(due)}</span>`;
      html += `</div>`;
      html += `<div class="progress-bar" style="height:6px; margin-bottom:4px; background:rgba(255,255,255,0.05);"><div class="progress-fill" style="width:${pct}%;"></div></div>`;
      html += `<div style="display:flex; justify-content:space-between; font-size:11px; color:var(--muted);">`;
      html += `<span class="collection-status-line"><span class="status-paid">PAID: ${paidStudents}</span><span class="status-partial">PARTIALLY PAID: ${partialStudents}</span><span class="status-unpaid">UNPAID: ${unpaidStudents}</span></span>`;
      html += `<span>Balance: ${peso(balance)}</span>`;
      html += `</div></div>`;
    });
    html += `</div></div>`;
  }

  /* ═══════ SYSTEM / BACKUP STATUS ═══════ */
  const lastBackup = localStorage.getItem("lastBackupTime");
  html += `<div class="eve-guide-section" style="border-left:3px solid var(--info);">`;
  html += `<h4 style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">`;
  html += `<span class="eve-summary-badge" style="background:var(--info);">System</span> Status</h4>`;
  if (!lastBackup) {
    html += `<p style="color:var(--danger); font-size:12px; font-weight:600; margin:0;">⚠ You have never backed up your data yet.</p>`;
  } else {
    const days = Math.floor((Date.now() - parseInt(lastBackup, 10)) / (1000 * 60 * 60 * 24));
    if (days <= 0) html += `<p style="color:var(--success); font-size:12px; font-weight:600; margin:0;">✓ Last backup: today</p>`;
    else if (days <= 7) html += `<p style="color:${days <= 3 ? 'var(--success)' : 'var(--warning)'}; font-size:12px; font-weight:600; margin:0;">Last backup: ${days} day(s) ago</p>`;
    else html += `<p style="color:var(--danger); font-size:12px; font-weight:600; margin:0;">⚠ Last backup: ${days} days ago — back up soon!</p>`;
  }
  html += `<p class="note" style="margin-top:6px; color:var(--muted);">Mode: <b style="color:var(--ink, #1F2A24);">${mode === 'org' ? 'Organization Treasurer' : 'Class Treasurer'}</b></p>`;
  html += `</div>`;

  html += '</div>';
  box.innerHTML = html;
  
  box.querySelectorAll('.eve-summary-card:not(.display-only)').forEach(card => {
    const title = card.querySelector('h4')?.innerText.trim() || 'Overview Detail';
    const section = card.closest('.eve-guide-section')?.querySelector('.eve-summary-badge')?.innerText.trim() || 'Overview';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Open details for ${title}`);
    const open = () => openEveSummaryDetail(title, section);
    card.addEventListener('click', open);
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
  });
}



function closeEveSummaryDetail() {
  document.getElementById("eve-summary-detail-overlay")?.classList.add("hidden");
}

function openEveSummaryDetail(title, section = "Overview") {
  const overlay = document.getElementById("eve-summary-detail-overlay");
  const titleEl = document.getElementById("eve-summary-detail-title");
  const content = document.getElementById("eve-summary-detail-content");
  if (!overlay || !titleEl || !content) return;
  titleEl.innerText = title;
  content.innerHTML = renderEveSummaryDetail(title, section);
  overlay.classList.remove("hidden");
}

function renderEveSummaryDetail(title, section) {
  const row = (label, value, note = "") => `<div class="item-row" style="cursor:default;"><div><b>${esc(label)}</b>${note ? `<br><span class="note">${esc(note)}</span>` : ""}</div><strong>${value}</strong></div>`;

  const isIncomeTxn = txn => txn.type === "income" || txn.type === "remittance" || String(txn.type).toLowerCase() === "remittance";

  const cashbookComputation = () => {
    const allTxns = (db.cashbook?.transactions || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const income = round2(allTxns.filter(isIncomeTxn).reduce((sum, txn) => sum + (Number(txn.amount) || 0), 0));
    const expenses = round2(allTxns.filter(txn => txn.type === "expense").reduce((sum, txn) => sum + (Number(txn.amount) || 0), 0));
    const opening = round2(db.cashbook?.openingBalance || db.cashbook?.opening || 0);
    const cashOnHand = round2(opening + income - expenses);
    
    const allRowsHtml = allTxns
      .map(txn => {
        const isExpense = txn.type === "expense";
        const sign = isExpense ? "−" : "+";
        const color = isExpense ? "var(--danger)" : "var(--success)";
        const displayCategory = txn.category || (isExpense ? "Expense Log" : "Income Log");
        
        return row(
          txn.description || displayCategory, 
          `<span style="color:${color}; font-weight:700;">${sign}${peso(txn.amount)}</span>`, 
          `${txn.date || "No date"} • ${displayCategory}`
        );
      })
      .join("") || `<p class="note">No transactions recorded yet.</p>`;

    return `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
        <div class="item-row" style="cursor:default;"><div><b>Income</b></div><strong style="color:var(--success);">${peso(income)}</strong></div>
        <div class="item-row" style="cursor:default;"><div><b>Expenses</b></div><strong style="color:var(--danger);">${peso(expenses)}</strong></div>
      </div>
      <div class="eve-guide-section" style="margin-bottom:12px;">
        <p style="margin:0; text-align:center; font-family:'IBM Plex Mono',monospace; font-size:12px;">
          ${peso(opening)} opening + ${peso(income)} income − ${peso(expenses)} expenses = <b>${peso(cashOnHand)} cash on hand</b>
        </p>
      </div>
      <div style="max-height:280px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
        ${allRowsHtml}
      </div>`;
  };

  const projectRows = () => (db.projects || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map(project => {
    const txns = (db.cashbook?.transactions || []).filter(txn => String(txn.projectId) === String(project.id));
    const spent = round2(txns.filter(txn => txn.type === "expense").reduce((sum, txn) => sum + (Number(txn.amount) || 0), 0));
    const income = round2(txns.filter(txn => txn.type === "income").reduce((sum, txn) => sum + (Number(txn.amount) || 0), 0));
    return row(project.name, peso(round2(income - spent)), `Budget: ${peso(project.budget || 0)} • Income: ${peso(income)} • Spent: ${peso(spent)}`);
  }).join("") || `<p class="note">No projects or events yet.</p>`;

  // ── STRING INITIALIZATION AND ROUTING LAYER ──
  const checkTitle = String(title || "").trim().toLowerCase();
  const checkSection = String(section || "").trim().toLowerCase();
  let htmlOutput = "";

  // 1. ALL COLLECTION CATEGORIES: SHOW ONLY NAMES
  if (/categories/i.test(checkTitle) || /all collection categories/i.test(checkTitle)) {
    const categoryNames = Object.keys(db.categories || {}).sort((a, b) => a.localeCompare(b));
    
    htmlOutput = categoryNames.map(name => {
      return `<div class="item-row" style="cursor:default; padding:12px 14px;">
        <div><span style="font-size: 15px; font-weight: 600; color: #E9F0EB;">📁 ${esc(name)}</span></div>
      </div>`;
    }).join("") || `<p class="note">No collection categories found.</p>`;
  }

  // 2. TOTAL COLLECTED: SHOW ONLY PARTIALLY PAID & FULLY PAID RECORDS
  else if (/collected/i.test(checkTitle)) {
    Object.keys(db.categories || {}).sort((a, b) => a.localeCompare(b)).forEach(category => {
      const records = (db.categories[category]?.records || [])
        .filter(r => (Number(r.paid) || 0) > 0)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (records.length > 0) {
        const rowsHtml = records.map(r => {
          const balance = round2(Number(r.due) - Number(r.paid));
          const isFullyPaid = balance <= 0;
          const statusText = isFullyPaid ? "FULLY PAID" : "PARTIALLY PAID";
          const statusColor = isFullyPaid ? "var(--success)" : "var(--warning)";
          
          return `<div class="item-row" style="cursor:default; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.04);">
            <div><b>${esc(r.name)}</b><br><span class="note">Collected: ${peso(r.paid)} / Due: ${peso(r.due)}</span></div>
            <strong style="color:${statusColor}; font-size:11px; text-transform:uppercase;">${statusText}</strong>
          </div>`;
        }).join("");

        htmlOutput += `<div class="eve-guide-section" style="margin-bottom:14px; background:rgba(255,255,255,0.02); padding:10px; border-radius:var(--radius-sm);">
          <h4 style="margin:0 0 8px 0; color:var(--accent); font-size:14px; border-bottom:1px dashed rgba(255,255,255,0.1); padding-bottom:4px;">📁 ${esc(category)}</h4>
          <div style="display:flex; flex-direction:column; gap:6px;">${rowsHtml}</div>
        </div>`;
      }
    });
    if (!htmlOutput) htmlOutput = `<p class="note">No collections have received partial or full payments yet.</p>`;
  }

  // 3. TOTAL BALANCE: SHOW ONLY UNPAID RECORDS (BALANCE > 0)
  else if (/balance/i.test(checkTitle) && !/total income/i.test(checkTitle) && !/total expenses/i.test(checkTitle) && checkSection !== "cashbook") {
    Object.keys(db.categories || {}).sort((a, b) => a.localeCompare(b)).forEach(category => {
      const records = (db.categories[category]?.records || [])
        .filter(r => round2(Number(r.due) - Number(r.paid)) > 0)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (records.length > 0) {
        const rowsHtml = records.map(r => {
          const balance = round2(Number(r.due) - Number(r.paid));
          const hasZeroPayments = Number(r.paid) <= 0;
          const statusText = hasZeroPayments ? "UNPAID" : "PARTIAL DEBT";
          const statusColor = hasZeroPayments ? "var(--danger)" : "var(--warning)";

          return `<div class="item-row" style="cursor:default; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.04);">
            <div><b>${esc(r.name)}</b><br><span class="note">Owed Balance: ${peso(balance)} (Paid: ${peso(r.paid)})</span></div>
            <strong style="color:${statusColor}; font-size:11px; text-transform:uppercase;">${statusText}</strong>
          </div>`;
        }).join("");

        htmlOutput += `<div class="eve-guide-section" style="margin-bottom:14px; background:rgba(255,255,255,0.02); padding:10px; border-radius:var(--radius-sm);">
          <h4 style="margin:0 0 8px 0; color:var(--danger); font-size:14px; border-bottom:1px dashed rgba(255,255,255,0.1); padding-bottom:4px;">📁 ${esc(category)}</h4>
          <div style="display:flex; flex-direction:column; gap:6px;">${rowsHtml}</div>
        </div>`;
      }
    });
    if (!htmlOutput) htmlOutput = `<p class="note">Perfect score! No unpaid balances left across any categories.</p>`;
  }

  // 4. CASH BOOK ROUTING MATRIX FOR SPECIFIC CARD INTERACTION CLICKS
  else if (/cash book balance/i.test(checkTitle) || /cash on hand/i.test(checkTitle)) {
    htmlOutput = cashbookComputation();
  }
  else if (/total income/i.test(checkTitle) || checkTitle === "income") {
    const incomeTxns = (db.cashbook?.transactions || [])
      .filter(isIncomeTxn)
      .slice()
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      
    htmlOutput = incomeTxns.map(txn => {
      const displayCategory = txn.category || "Income Log";
      return row(
        txn.description || displayCategory, 
        `<span style="color:var(--success); font-weight:700;">+${peso(txn.amount)}</span>`, 
        `${txn.date || "No date"} • ${displayCategory}`
      );
    }).join("") || `<p class="note">No income records found for this view context.</p>`;
  }
  else if (/total expenses/i.test(checkTitle) || checkTitle === "expenses") {
    const expenseTxns = (db.cashbook?.transactions || [])
      .filter(txn => txn.type === "expense")
      .slice()
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      
    htmlOutput = expenseTxns.map(txn => {
      const displayCategory = txn.category || "Expense Log";
      return row(
        txn.description || displayCategory, 
        `<span style="color:var(--danger); font-weight:700;">−${peso(txn.amount)}</span>`, 
        `${txn.date || "No date"} • ${displayCategory}`
      );
    }).join("") || `<p class="note">No expense records found for this view context.</p>`;
  }
  else if (/projects/i.test(checkTitle)) {
    htmlOutput = projectRows();
  }
  else if (/year levels|students/i.test(checkTitle)) {
    htmlOutput = (db.students || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map(s => row(s.name, isOrg() ? "Year Level" : "Student")).join("");
  }
  else {
    htmlOutput = `<p class="note">No filter rule matches for specified view context.</p>`;
  }

  return `<div class="eve-guide-section" style="border-left:3px solid var(--accent-2); max-height:450px; overflow-y:auto;">
    <p class="note" style="margin-bottom:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:var(--muted);">${esc(title)} Breakdown</p>
    <div style="display:flex; flex-direction:column; gap:8px;">${htmlOutput}</div>
  </div>`;
}




/* Calculator helpers */
function calcInput(v) {
  if (calcExpression === "0" && v !== ".") calcExpression = "";
  calcExpression += v;
  document.getElementById("calc-display").innerText = calcExpression || "0";
}
function calcClear() { calcExpression = ""; document.getElementById("calc-display").innerText = "0"; }
function calcBack() { calcExpression = calcExpression.slice(0, -1); document.getElementById("calc-display").innerText = calcExpression || "0"; }
function calcEqual() {
  try {
    const safe = calcExpression.replace(/[^0-9+\-*/.]/g, "");
    const res = Function('"use strict"; return (' + safe + ')')();
    calcExpression = String(Math.round((res + Number.EPSILON) * 100) / 100);
    document.getElementById("calc-display").innerText = calcExpression;
  } catch (e) { document.getElementById("calc-display").innerText = "Err"; }
}

/* ================= COLLECTION TRANSFERS ================= */
function openTransferModal() {
  const modal = document.getElementById("transfer-modal");
  const select = document.getElementById("transfer-to-select");
  document.getElementById("transfer-from-name").innerText = currentCategory;
  document.getElementById("transfer-amount").value = "";
  document.getElementById("transfer-date").value = new Date().toISOString().slice(0,10);
  document.getElementById("transfer-note").value = "";
  document.getElementById("transfer-error").innerText = "";

  const others = Object.keys(db.categories).filter(c => c !== currentCategory).sort();
  select.innerHTML = others.length
    ? others.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")
    : `<option disabled>No other collections</option>`;

  modal.classList.remove("hidden");
}

function closeTransferModal() {
  document.getElementById("transfer-modal").classList.add("hidden");
}

function confirmTransfer() {
  const to = document.getElementById("transfer-to-select").value;
  const amount = round2(parseFloat(document.getElementById("transfer-amount").value) || 0);
  const date = document.getElementById("transfer-date").value || new Date().toISOString().slice(0,10);
  const note = document.getElementById("transfer-note").value.trim();
  const err = document.getElementById("transfer-error");

  if (!to || !db.categories[to]) { err.innerText = "Pick a destination collection."; return; }
  if (amount <= 0) { err.innerText = "Enter a valid amount."; return; }

  const catObj = db.categories[currentCategory];
  const gross = catObj.records.reduce((s,r) => s + r.paid, 0);
  const out   = (db.transfers||[]).filter(t => t.from === currentCategory).reduce((s,t)=>s+t.amount,0);
  const inn   = (db.transfers||[]).filter(t => t.to   === currentCategory).reduce((s,t)=>s+t.amount,0);
  const net   = gross + inn - out;

  if (amount > net) { err.innerText = `Available after prior transfers is only ${peso(net)}.`; return; }

  db.transfers.push({
    id: Date.now()+"-"+Math.random().toString(36).slice(2,7),
    from: currentCategory, to, amount, date, note
  });
  saveData();
  closeTransferModal();
  renderItemList();
  renderCategories();
  eveAlert(`Transferred ${peso(amount)} to "${to}".`);
}

function deleteTransfer(id) {
  if (!confirm("Delete this transfer record? This restores the amount to both collections' available balance.")) return;
  db.transfers = (db.transfers || []).filter(t => String(t.id) !== String(id));
  saveData();

  // Refresh whichever view(s) are currently showing this data
  const itemView = document.getElementById('item-view');
  if (itemView && !itemView.classList.contains('hidden') && currentCategory) {
    renderItemList();
  }
  renderCategories();

  const logsView = document.getElementById('eve-logs-view');
  if (logsView && !logsView.classList.contains('hidden')) {
    renderEveLogs();
  }

  eveAlert("Transfer deleted.");
}

/* ================= EVE NOTEPAD ================= */
function openEveNotes() {
  _hideAllInventoryViews();
  const view = document.getElementById("eve-notes-view");
  if (view) view.classList.remove("hidden");
  const btn = document.getElementById("notes-plus-btn");
  if (btn) btn.classList.remove("hidden");
  
  renderNotesList();
  
  const head = document.getElementById("eveHead");
  if (head) {
    head.classList.remove('is-stretching', 'is-smiling');
    head.classList.add('is-looking-inventory');
  }
}

function openEveLogs() {
  _hideAllInventoryViews();
  const view = document.getElementById("eve-logs-view");
  if (view) view.classList.remove("hidden");

  const head = document.getElementById("eveHead");
  if (head) {
    head.classList.remove('is-stretching', 'is-smiling');
    head.classList.add('is-looking-inventory');
  }
  renderEveLogs();
}

function renderEveLogs() {
  const box = document.getElementById("eve-logs-view");
  if (!box) return;

  const txfers = (db.transfers || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  let html = '<div style="width:100%;">';

  // ═══ UNDO / REDO ═══
  html += `<div class="eve-guide-section" style="border-left:3px solid var(--warning); text-align:center;">`;
  html += `<h4 style="justify-content:center; display:flex; align-items:center; gap:8px; margin-bottom:12px;">`;
  html += `<span class="eve-summary-badge" style="background:var(--warning); color:#1F2A24;">History</span> Undo / Redo</h4>`;
  html += `<div style="display:flex; gap:12px; justify-content:center; margin-bottom:10px; flex-wrap:wrap;">`;
  html += `<button id="undo-btn-logs" onclick="performUndo()" ${undoStack.length === 0 ? 'disabled' : ''} style="width:auto; padding:10px 20px; opacity:${undoStack.length === 0 ? '0.4' : '1'};">↺ Undo (<span id="undo-count-logs">${undoStack.length}</span>)</button>`;
  html += `<button id="redo-btn-logs" onclick="performRedo()" ${redoStack.length === 0 ? 'disabled' : ''} style="width:auto; padding:10px 20px; background:var(--surface); color:var(--ink); border:1.5px solid var(--hairline); opacity:${redoStack.length === 0 ? '0.4' : '1'};">↻ Redo (<span id="redo-count-logs">${redoStack.length}</span>)</button>`;
  html += `</div>`;
  html += `<p class="note">Reverts or replays your most recent actions — payments, additions, deletions, transfers, and more. History resets when the app is reloaded.</p>`;
  html += `</div>`;

  // Header stats
  const totalTransferred = round2(txfers.reduce((s, t) => s + (Number(t.amount) || 0), 0));
  const uniqueCollections = new Set();
  txfers.forEach(t => { uniqueCollections.add(t.from); uniqueCollections.add(t.to); });

  html += `<div class="eve-guide-section" style="border-left:3px solid var(--accent-2);">`;
  html += `<h4 style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">`;
  html += `<span class="eve-summary-badge" style="background:var(--accent-2);">⇄ Transfers</span> Transaction Logs</h4>`;
  html += `<div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:12px;">`;
  html += `<div class="eve-summary-card"><h4>Total Transfers</h4><p>${txfers.length}</p></div>`;
  html += `<div class="eve-summary-card"><h4>Total Amount Moved</h4><p style="color:var(--accent-2);">${peso(totalTransferred)}</p></div>`;
  html += `<div class="eve-summary-card"><h4>Collections Involved</h4><p>${uniqueCollections.size}</p></div>`;
  html += `</div></div>`;

  if (txfers.length === 0) {
    html += `<div class="eve-guide-section" style="text-align:center; padding:40px 20px; background:linear-gradient(135deg, #141c18, #1a2420); border:1px solid rgba(233,240,235,0.10);">`;
    html += `<p style="font-size:28px; margin-bottom:10px;">📭</p>`;
    html += `<p style="font-weight:600; color:var(--ink); margin-bottom:6px;">No transfers yet</p>`;
    html += `<p class="note">Transfer funds between collections from the Records tab and they will appear here automatically.</p>`;
    html += `</div>`;
  } else {
    html += `<div class="eve-guide-section" style="border-left:3px solid var(--accent);">`;
    html += `<h4 style="margin-bottom:12px; font-size:13px; color:var(--muted); text-transform:uppercase; letter-spacing:1px;">All Transfer Records</h4>`;
    html += `<div style="display:flex; flex-direction:column; gap:8px;">`;

    txfers.forEach(t => {
      html += `<div style="background:linear-gradient(135deg, #141c18, #1a2420); border:1px solid rgba(233,240,235,0.10); border-radius:var(--radius); padding:14px 16px; box-shadow:0 2px 8px rgba(0,0,0,0.35); transition:all 0.2s ease;">`;
      html += `<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; flex-wrap:wrap; gap:6px;">`;
      html += `<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">`;
      html += `<span style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--muted); background:var(--surface-alt); padding:3px 8px; border-radius:6px; border:1px solid var(--hairline);">${esc(t.date)}</span>`;
      html += `</div>`;
      html += `<span style="font-family:'IBM Plex Mono',monospace; font-size:18px; font-weight:700; color:var(--accent-2);">${peso(t.amount)}</span>`;
      html += `</div>`;

      html += `<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:${t.note ? '6px' : '0'};">`;
      html += `<div style="display:flex; align-items:center; gap:6px; background:rgba(179,66,59,0.15); border:1px solid rgba(179,66,59,0.25); padding:5px 10px; border-radius:6px;">`;
      html += `<span style="font-size:10px; text-transform:uppercase; color:var(--danger); font-weight:700; letter-spacing:0.5px;">From</span>`;
      html += `<span style="font-weight:600; color:#E9F0EB; font-size:13px;">${esc(t.from)}</span>`;
      html += `</div>`;

      html += `<span style="color:var(--muted); font-size:14px;">→</span>`;

      html += `<div style="display:flex; align-items:center; gap:6px; background:rgba(47,125,83,0.15); border:1px solid rgba(47,125,83,0.25); padding:5px 10px; border-radius:6px;">`;
      html += `<span style="font-size:10px; text-transform:uppercase; color:var(--success); font-weight:700; letter-spacing:0.5px;">To</span>`;
      html += `<span style="font-weight:600; color:#E9F0EB; font-size:13px;">${esc(t.to)}</span>`;
      html += `</div>`;
      html += `</div>`;

     if (t.note) {
        html += `<p class="note" style="margin-top:4px; padding-top:6px; border-top:1px solid var(--hairline);">📝 ${esc(t.note)}</p>`;
      }
      html += `<div style="text-align:right; margin-top:8px;">`;
      html += `<button class="mini-btn mini-delete" data-action="delete-transfer-log" data-id="${esc(t.id)}">DEL</button>`;
      html += `</div>`;
      html += `</div>`;
    });

    html += `</div></div>`;
  }

  html += '</div>';
  box.innerHTML = html;

  box.querySelectorAll('[data-action="delete-transfer-log"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTransfer(btn.dataset.id);
    });
  });
}


let currentNoteId = null;

function renderNotesList() {
  document.getElementById("notes-folder-list").classList.remove("hidden");
  document.getElementById("notes-note-list")?.classList.add("hidden");
  document.getElementById("notes-editor").classList.add("hidden");
  // Whenever the list view is shown, the "+ New Note" button must be visible too —
  // it only hides while actively editing a note (see openNoteEditor). Restoring it
  // here (rather than only in backToNoteList) guards every path back to the list,
  // including closing the notepad mid-edit via the overlay's own "← Back" button.
  document.getElementById("notes-plus-btn")?.classList.remove("hidden");
  currentNoteId = null;

  const box = document.getElementById("notes-folder-list");
  const np = db.notepad || { notes: [] };
  
  if (!np.notes || np.notes.length === 0) {
    box.innerHTML = `<p class="note" style="text-align:center; margin-top:40px;">No notes yet.<br>Tap the <b>+</b> button to create your first note.</p>`;
    return;
  }
  
  box.innerHTML = `<div style="display:flex; flex-direction:column; gap:10px;">` +
    np.notes
      .sort((a, b) => (b.updated || "").localeCompare(a.updated || ""))
      .map(n => `
        <div class="add-all-item" style="cursor:default;">
          <div style="flex:1; cursor:pointer;" onclick="openNoteEditor('${esc(n.id)}')">
            <span style="font-weight:600;">📝 ${esc(n.title || 'Untitled')}</span><br>
            <span class="note">${esc(n.updated || '')}</span>
          </div>
          <button class="del-btn" onclick="deleteNote('${esc(n.id)}')" style="margin-left:10px; width:auto; height:auto; padding:6px 12px;">Delete</button>
        </div>
      `).join('') + `</div>`;
}

function createNewNoteFlow() {
  const raw = prompt("Note title:", "New Note");
  if (raw === null) return;                 // Cancelled — do nothing
  const title = raw.trim();
  if (!title) return;                       // Empty title — do nothing
  
  if (!db.notepad) db.notepad = { notes: [] };
  const id = Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  db.notepad.notes.push({
    id,
    title,
    content: "",
    updated: new Date().toISOString().slice(0, 10)
  });
  saveData();
  renderNotesList();
  openNoteEditor(id);
}

function openNoteEditor(noteId) {
  const note = (db.notepad?.notes || []).find(n => n.id === noteId);
  if (!note) return;
  currentNoteId = noteId;
  
  document.getElementById("notes-folder-list").classList.add("hidden");
  document.getElementById("notes-note-list")?.classList.add("hidden");
  document.getElementById("notes-editor").classList.remove("hidden");
  document.getElementById("notes-plus-btn").classList.add("hidden");
  
  document.getElementById("note-editor-title").value = note.title || "";
  document.getElementById("note-editor-body").value = note.content || "";
}

function saveCurrentNote() {
  const note = (db.notepad?.notes || []).find(n => n.id === currentNoteId);
  if (!note) return;
  
  note.title = document.getElementById("note-editor-title").value.trim() || "Untitled";
  note.content = document.getElementById("note-editor-body").value;
  note.updated = new Date().toISOString().slice(0, 10);
  
  saveData();
  backToNoteList();
}

function backToNoteList() {
  document.getElementById("notes-editor").classList.add("hidden");
  document.getElementById("notes-folder-list").classList.remove("hidden");
  document.getElementById("notes-plus-btn").classList.remove("hidden");
  renderNotesList();
}

function deleteNote(noteId) {
  if (!confirm("Delete this note?")) return;
  if (!db.notepad || !db.notepad.notes) return;
  db.notepad.notes = db.notepad.notes.filter(n => n.id !== noteId);
  saveData();
  renderNotesList();
}

function matchesQuickPayYear(record) {
  if (quickPayYearFilter === "all" || !isOrg()) return true;
  const owner = db.students.find(yearLevel =>
    yearLevel.name === record.name || (yearLevel.students || []).some(student => student.name === record.name)
  );
  return owner ? yearLevelBucket(owner.name) === quickPayYearFilter : false;
}

function setQuickPayYearFilter(value) {
  quickPayYearFilter = value || "all";
  renderQuickPayList();
}

/**
 * Triggers when "+ Add All Students" is clicked inside the Collection Edit Modal.
 * Opens the '#record-roster-picker' layout window and establishes the collection context.
 */
function getActiveCollectionRecord() {
  const recordName = document.getElementById("collection-edit-student-name")?.innerText.trim();
  const catObj = db.categories[currentCategory];
  return catObj?.records?.find(record => record.name === recordName) || null;
}

function getActiveRecordRoster() {
  const record = getActiveCollectionRecord();
  const yearLevel = record ? db.students.find(student => student.name === record.name) : null;
  if (!record || !yearLevel) return { record, yearLevel, roster: [] };
  record.studentLedger = Array.isArray(record.studentLedger) ? record.studentLedger : [];
  record.studentLedger.forEach(student => {
    if (student.paymentStatus !== "paid" && student.paymentStatus !== "unpaid") student.paymentStatus = "paid";
  });
  return { record, yearLevel, roster: record.studentLedger };
}

let recordRosterPickerSelected = new Set();

function getVisibleRecordRosterPickerStudents() {
  const { record, yearLevel, roster } = getActiveRecordRoster();
  const query = (document.getElementById("record-roster-picker-search")?.value || "").trim().toLowerCase();
  if (!record || !yearLevel) return [];
  const existing = new Set(roster.map(student => String(student.studentId)));
  return (Array.isArray(yearLevel.students) ? yearLevel.students : []).filter(student =>
    !existing.has(String(student.id)) && student.name.toLowerCase().includes(query)
  );
}

function selectAllRecordRosterPicker() {
  getVisibleRecordRosterPickerStudents().forEach(student => recordRosterPickerSelected.add(String(student.id)));
  renderRecordRosterPicker();
}

function deselectAllRecordRosterPicker() {
  getVisibleRecordRosterPickerStudents().forEach(student => recordRosterPickerSelected.delete(String(student.id)));
  renderRecordRosterPicker();
}

function renderRecordRosterPicker() {
  const list = document.getElementById("record-roster-picker-list");
  if (!list) return;
  const { record, yearLevel, roster } = getActiveRecordRoster();
  const query = (document.getElementById("record-roster-picker-search")?.value || "").trim().toLowerCase();
  if (!record || !yearLevel) {
    list.innerHTML = `<p class="note">Open a valid year-level record first.</p>`;
    return;
  }
  const available = getVisibleRecordRosterPickerStudents();
  const status = document.getElementById("record-roster-picker-status");
  if (status) status.innerText = `${recordRosterPickerSelected.size} selected`;
  list.innerHTML = available.length ? available.map(student => `
    <label class="record-roster-pick-row">
      <input type="checkbox" value="${esc(student.id)}" data-roster-name="${esc(student.name)}" ${recordRosterPickerSelected.has(String(student.id)) ? "checked" : ""} onchange="toggleRecordRosterPicker('${esc(student.id)}')">
      <span>${esc(student.name)}</span>
    </label>`).join("") : `<p class="note">${yearLevel.students?.length ? "All students are already in this bucket or no names match." : "No students have been added to this year level database yet."}</p>`;
}

function toggleRecordRosterPicker(studentId) {
  const key = String(studentId);
  if (recordRosterPickerSelected.has(key)) recordRosterPickerSelected.delete(key);
  else recordRosterPickerSelected.add(key);
  renderRecordRosterPicker();
}

function confirmRecordRosterPicker() {
  const { record, yearLevel } = getActiveRecordRoster();
  if (!record || !yearLevel) return;
  const selected = (Array.isArray(yearLevel.students) ? yearLevel.students : [])
    .filter(student => recordRosterPickerSelected.has(String(student.id)));
  if (!selected.length) return eveAlert("Select at least one student.", true);
  selected.forEach(student => {
    if (!record.studentLedger.some(item => String(item.studentId) === String(student.id))) {
      record.studentLedger.push({ studentId: student.id, name: student.name, paymentStatus: "paid" });
    }
  });
  saveData();
  closeRecordRosterPicker();
  updateRecordRosterIndicator();
}

function renderRecordRosterBucket() {
  const list = document.getElementById("record-roster-list");
  if (!list) return;
  const { record, roster } = getActiveRecordRoster();
  const query = (document.getElementById("record-roster-search")?.value || "").trim().toLowerCase();
  const filter = document.getElementById("record-roster-status-filter")?.value || "all";
  const matches = roster
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .filter(student => student.name.toLowerCase().includes(query) && (filter === "all" || student.paymentStatus === filter));
  const paid = roster.filter(student => student.paymentStatus === "paid").length;
  const indicator = document.getElementById("record-roster-paid-indicator-full");
  if (indicator) indicator.innerText = `${paid} paid / ${roster.length} students`;
  list.innerHTML = matches.length ? matches.map((student, index) => `
    <div class="record-roster-row ${student.paymentStatus === "paid" ? "roster-status-paid" : "roster-status-unpaid"}">
      <b>${esc(student.name)}</b>
      <div class="roster-actions">
        <button class="mini-btn" onclick="toggleRecordRosterPaid('${esc(student.studentId)}')">Status: ${student.paymentStatus === "paid" ? "Paid" : "Unpaid"}</button>
        <button class="del-btn" onclick="removeRecordRosterStudent('${esc(student.studentId)}')">X</button>
      </div>
    </div>`).join("") : `<p class="note">No students match this filter.</p>`;
  updateRecordRosterIndicator();
}

function updateRecordRosterIndicator() {
  const { roster } = getActiveRecordRoster();
  
  // 1. Calculate the target metric variables
  const totalStudents = roster.length;
  const paidCount = roster.filter(student => student.paymentStatus === "paid").length;
  const unpaidCount = totalStudents - paidCount;
  
  // 2. Format the updated three-part status text
  const text = `(${paidCount}) paid & (${unpaidCount}) unpaid out of (${totalStudents}) students`;
  
  // 3. Update both matching element container targets in the DOM
  ["record-roster-paid-indicator", "record-roster-paid-indicator-full"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
  });
}


function toggleRecordRosterPaid(studentId) {
  const { record, roster } = getActiveRecordRoster();
  const student = roster.find(item => String(item.studentId) === String(studentId));
  if (!record || !student) return;
  const nextStatus = student.paymentStatus === "paid" ? "unpaid" : "paid";
  if (!confirm(`Change ${student.name}'s status to ${nextStatus === "paid" ? "Paid" : "Unpaid"}?`)) return;
  student.paymentStatus = nextStatus;
  saveData();
  renderRecordRosterBucket();
}

function removeRecordRosterStudent(studentId) {
  const { record } = getActiveRecordRoster();
  if (!record) return;
  const student = (record.studentLedger || []).find(item => String(item.studentId) === String(studentId));
  if (!student || !confirm(`Remove ${student.name} from this student bucket?`)) return;
  record.studentLedger = (record.studentLedger || []).filter(item => String(item.studentId) !== String(studentId));
  saveData();
  renderRecordRosterBucket();
}

function openRecordRosterPicker() {
  const pickerModal = document.getElementById("record-roster-picker");
  const editModal = document.getElementById("collection-edit-modal");

  if (!pickerModal) {
    console.error("Layout element missing: '#record-roster-picker' target container not found.");
    return;
  }

  // 1. Scrape the active collection row context name text string safely (e.g. "fwsdf2")
  const sourceTitleNode = document.getElementById("collection-edit-student-name");
  const activeRecordName = sourceTitleNode ? sourceTitleNode.innerText.trim() : "this collection";

  // 2. Map the context title string directly to your picker subtext element label node
  const pickerLabelNode = document.getElementById("record-roster-picker-title");
  if (pickerLabelNode) {
    pickerLabelNode.innerText = `Select who to add into: ${activeRecordName}`;
  }

  // 3. Hide the collection edit popup block canvas screen to prevent stack overlapping
  if (editModal) {
    editModal.classList.add("hidden");
  }

  // 4. Clean out any previous query entries from the modal filter bar
  const searchBar = document.getElementById("record-roster-picker-search");
  if (searchBar) searchBar.value = "";
  recordRosterPickerSelected.clear();

  // 5. Open the modal frame layer window drawer view panel
  pickerModal.classList.remove("hidden");

  // 6. Fire your internal rendering handler script routine to build your checklist data
  if (typeof renderRecordRosterPicker === "function") {
    renderRecordRosterPicker();
  } else {
    console.warn("Notice: Required helper hook 'renderRecordRosterPicker()' is missing or unassigned.");
  }
}

/**
 * Triggers when "Open Student Bucket" is clicked inside the Collection Edit Modal.
 * Opens the fullscreen list frame layer window '#record-roster-overlay'.
 */
function openRecordRosterBucket() {
  const bucketOverlay = document.getElementById("record-roster-overlay");
  const editModal = document.getElementById("collection-edit-modal");

  if (!bucketOverlay) {
    console.error("Layout element missing: '#record-roster-overlay' target container not found.");
    return;
  }

  // 1. Scrape active parent profile string context text info safely
  const sourceTitleNode = document.getElementById("collection-edit-student-name");
  const activeRecordName = sourceTitleNode ? sourceTitleNode.innerText.trim() : "Student Bucket";

  // 2. Push it dynamically straight into the header title node inside the fullscreen pane
  const overlayTitleNode = document.getElementById("record-roster-title");
  if (overlayTitleNode) {
    overlayTitleNode.innerText = `${activeRecordName} — Bucket`;
  }

  // 3. Dismiss background edit window safely
  if (editModal) {
    editModal.classList.add("hidden");
  }

  // 4. Clear any persistent list view filters back to default baseline states
  const overlaySearch = document.getElementById("record-roster-search");
  if (overlaySearch) overlaySearch.value = "";
  
  const statusFilter = document.getElementById("record-roster-status-filter");
  if (statusFilter) statusFilter.value = "all";

  // 5. Display the fullscreen student ledger record drawer interface
  bucketOverlay.classList.remove("hidden");

  // 6. Fire the view renderer loop code engine method to list registered entries
  if (typeof renderRecordRosterBucket === "function") {
    renderRecordRosterBucket();
  } else {
    console.warn("Notice: Required helper hook 'renderRecordRosterBucket()' is missing or unassigned.");
  }
}

/**
 * Clean close handler for the Picker Modal interface component layout window.
 * Returns screen context tracking focus straight back down to your parent workspace wrapper.
 */
function closeRecordRosterPicker() {
  const pickerModal = document.getElementById("record-roster-picker");
  const editModal = document.getElementById("collection-edit-modal");

  if (pickerModal) {
    pickerModal.classList.add("hidden");
  }
  if (editModal) {
    editModal.classList.remove("hidden"); // Restores parent editor view window fluidly
  }
}

/**
 * Clean close handler for the Fullscreen Student Bucket interface drawer overlay panel.
 * Re-reveals the baseline category configuration dashboard sheet card.
 */
function closeRecordRosterBucket() {
  const bucketOverlay = document.getElementById("record-roster-overlay");
  const editModal = document.getElementById("collection-edit-modal");

  if (bucketOverlay) {
    bucketOverlay.classList.add("hidden");
  }
  if (editModal) {
    editModal.classList.remove("hidden"); // Returns user focus seamlessly back to the editor
  }
}

let studentBucket = []; // Array to store students added to bucket
let allStudents = []; // This should be populated from your database




function renderStudentBucket() {
  const listContainer = document.getElementById('student-bucket-list');
  listContainer.innerHTML = '';

  // Filter students based on search
  const searchQuery = document.getElementById('student-bucket-search').value.toLowerCase();
  const filteredStudents = allStudents.filter(s => s.name.toLowerCase().includes(searchQuery));

  filteredStudents.forEach(student => {
    const studentDiv = document.createElement('div');
    studentDiv.className = 'student-entry';
    studentDiv.style.display = 'flex'; 
    studentDiv.style.justifyContent = 'space-between'; 
    studentDiv.style.alignItems = 'center'; 
    studentDiv.style.padding = '4px 8px';

    // Student Name & Mark
    const nameSpan = document.createElement('span');
    nameSpan.textContent = student.name;

    const paidToggle = document.createElement('button');
    paidToggle.textContent = student.paid ? '✔️' : '❌';
    paidToggle.onclick = () => {
      student.paid = !student.paid;
      renderStudentBucket();
    };

    // Remove Button
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.onclick = () => {
      studentBucket = studentBucket.filter(s => s.id !== student.id);
      renderStudentBucket();
    };

    studentDiv.appendChild(nameSpan);
    studentDiv.appendChild(paidToggle);
    studentDiv.appendChild(removeBtn);

    listContainer.appendChild(studentDiv);
  });

  // Update paid count indicator if needed
  updatePaidIndicators();
}

function addStudentsFromBucket() {
  // Add selected students to the collection (depending on your existing system)
  studentBucket.forEach(s => {
    // Example: add to your collection data structure
    // addStudentPayment(s);
  });
  closeStudentBucket();
}

function addAllStudentsBucket() {
  // Add all students to the bucket
  studentBucket = [...allStudents];
  renderStudentBucket();
}

function updatePaidIndicators() {
  const total = studentBucket.length;
  const paidCount = studentBucket.filter(s => s.paid).length;
  // Update indicator UI
  // e.g., document.getElementById('paid-indicator').textContent = `${paidCount} paid / ${total} students`;
}

// Function to handle opening the Student Modal
function openCfStudentsOverlay() {
  const modal = document.getElementById('studentsOverlay');
  modal.classList.add('is-active');
  document.body.style.overflow = 'hidden'; // Stop background scroll
  
  if (typeof syncCfStudentsOverlay === 'function') {
    syncCfStudentsOverlay();
  }
}



// Global utility helper to close the modals
function closeCfModal(modalId) {
  document.getElementById(modalId).classList.remove('is-active');
  document.body.style.overflow = ''; // Restore page scrolling
}

// Close modal instantly if user clicks directly onto the outside blurred background layer
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeCfModal(overlay.id);
    }
  });
});

/* =========================================================================
   PIECE 3: FIXED MODAL VIEW ROUTER AND LIVE DATA INJECTION ENGINE
   ========================================================================= */

function openCfStudentsOverlay() {
  const overlay = document.getElementById("cf-students-overlay");
  if (!overlay) return;

  // Uncover view state frame layer natively
  overlay.classList.remove("hidden");
  document.body.style.overflow = "hidden"; // Freeze background scrolling matrix

  // Flush search container configurations back to default settings
  const searchBar = document.getElementById("cf-overlay-search");
  if (searchBar) searchBar.value = "";

  // Call the structured array compilation routine instantly
  syncCfStudentsOverlay();
}

function closeCfStudentsOverlay() {
  const overlay = document.getElementById("cf-students-overlay");
  if (overlay) {
    overlay.classList.add("hidden");
  }
  document.body.style.overflow = ""; // Reactivate baseline scrolling properties
}

/* =========================================================================
   COMPREHENSIVE STUDENT COLLECTION OVERLAY SYNCHRONIZATION ENGINE
   ========================================================================= */
function syncCfStudentsOverlay() {
  const target = document.getElementById("cf-overlay-list") || 
                 document.querySelector("#studentsOverlay .modal-content") ||
                 document.querySelector("#cf-students-overlay .modal-body");
                 
  if (!target || document.getElementById("cf-students-overlay")?.classList.contains("hidden")) return;

  const cf = db.classFund;
  const allStudents = Object.keys(cf.records || {}).sort();
  
  let students = allStudents;
  const searchInput = document.getElementById("cf-overlay-search") || document.getElementById("student-bucket-search");
  const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
  if (searchTerm) students = students.filter(n => n.toLowerCase().includes(searchTerm));

  if (students.length === 0) {
    target.innerHTML = `<p class="note" style="text-align:center; padding:20px; color:#6b7280;">No matching students found.</p>`;
    return;
  }

  target.innerHTML = students.map(name => {
    const rec = cf.records[name];
    const expected = getClassFundExpected(name);
    const missed = getMissedWeeks(name);
    const balance = round2(expected - rec.paid);
    const lastPay = getLastPaymentDate(name);
    const safeId = encodeURIComponent(name);
    const isExpanded = cfExpandedNames.has(name);
    const progressPct = expected > 0 ? Math.min(100, (rec.paid / expected) * 100) : 0;
    const lastPayText = lastPay ? `Last paid: ${formatDisplayDate(lastPay)}` : "Never paid";

    return `
      <div class="cf-student-card ${isExpanded ? 'expanded' : ''}" data-overlay-cf-name="${esc(name)}" style="background:#fff!important; padding:14px 16px!important; border:none!important; border-bottom:1px solid #eef1ef!important; border-radius:0!important; box-shadow:none!important; margin-bottom:0!important; cursor:pointer!important; display:flex!important; flex-direction:column!important; text-align:left!important; width:100%!important; box-sizing:border-box!important;">
        
        <!-- Header Information Bar Layout Row -->
        <div class="cf-card-header-row" style="display:flex!important; justify-content:space-between!important; align-items:center!important; width:100%!important;">
          <div style="flex:1!important; min-width:0!important;">
            <div style="display:flex!important; align-items:center!important; flex-wrap:wrap!important; gap:8px!important;">
              <b style="color:#111827!important; font-size:15px!important; font-weight:600!important;">${esc(name)}</b>
              <span class="cf-badge-minimal ${balance > 0 ? 'badg-warn' : 'badg-ok'}" style="font-size:11px!important; font-weight:500!important; padding:2px 6px!important; border-radius:4px!important; background:${balance > 0 ? '#fee2e2' : '#dcfce7'}!important; color:${balance > 0 ? '#991b1b' : '#15803d'}!important;">
                ${balance > 0 ? missed + ' weeks missed' : 'All Paid'}
              </span>
            </div>
            <div class="note" style="font-size:12px!important; color:#6b7280!important; margin-top:2px!important;">${lastPayText}</div>
          </div>
          <div style="text-align:right!important; flex-shrink:0!important; display:flex; align-items:center; gap:12px;">
            <div>
              <div style="font-size:16px!important; font-weight:600!important; color:${balance > 0 ? '#b3423b' : '#166534'}!important; font-family:'Inter',sans-serif!important;">${peso(rec.paid)}</div>
              <div class="note" style="font-size:12px!important; color:#6b7280!important;">of ${peso(expected)}</div>
            </div>
            <div class="cf-chevron" style="font-size:11px!important; color:#9ca3af!important; transform:${isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'}!important; transition:transform 0.2s ease!important;">▼</div>
          </div>
        </div>

        <!-- Collapsible Content Drawer Dropdown Element -->
        <div class="cf-details" onclick="event.stopPropagation()" style="display:${isExpanded ? 'block' : 'none'}!important; padding:12px 0 2px 0!important; width:100%!important; box-sizing:border-box!important;">
          <div class="minimal-progress-bar-container" style="height:4px!important; background:#f3f4f6!important; border-radius:2px!important; margin-bottom:14px!important; overflow:hidden!important; width:100%!important;">
            <div class="minimal-progress-bar-fill" style="width:${progressPct}%!important; height:100%!important; border-radius:2px!important; background:${balance > 0 ? '#b8872f' : '#166534'}!important;"></div>
          </div>
          
          <!-- Centered, Smaller Outline Style Trigger Button -->
          <div class="cf-payment-action-row-block" style="display:flex!important; justify-content:center!important; width:100%!important; margin-bottom:12px!important; margin-top:10px!important;">
            <button type="button" class="cf-minimalist-action-btn-trigger" data-action="overlay-add-pay" style="width:auto!important; min-width:140px!important; max-width:180px!important; padding:6px 16px!important; font-size:12px!important; font-weight:600!important; background:#ffffff!important; color:#166534!important; border:1px solid #d1d5db!important; border-radius:6px!important; cursor:pointer!important; box-shadow:0 1px 2px rgba(0,0,0,0.05)!important; text-align:center!important; display:inline-block!important; height:auto!important; line-height:1.2!important;">+ Add Payment</button>
          </div>
          
          <!-- Core Payment History Box Folder Layout Block -->
          ${rec.history.length > 0 ? `
            <div class="cf-minimalist-history-box-scroller" style="margin-top:6px!important; background-color:#f9fafb!important; padding:6px 12px!important; border-radius:6px!important; border:none!important; box-shadow:none!important; width:100%!important; box-sizing:border-box!important;">
              <p style="margin:0 0 4px 0!important; font-weight:700!important; color:#6b7280!important; font-size:10px!important; text-transform:uppercase!important; letter-spacing:0.5px!important;">Payment History</p>
              ${rec.history.slice().reverse().map((h, hIdx) => {
                const realIdx = rec.history.length - 1 - hIdx;
                return `
                  <!-- FIXED: Strict horizontal row parameters locked side-by-side without wrap-crushing strings -->
                  <div class="cf-minimalist-history-entry-row" style="display:flex!important; flex-direction:row!important; justify-content:space-between!important; align-items:center!important; padding:6px 0!important; border-bottom:1px solid #f3f4f6!important; font-size:13px!important; width:100%!important; box-sizing:border-box!important; flex-wrap:nowrap!important;">
                    <span class="cf-history-entry-log-text" style="color:#374151!important; font-size:13px!important; white-space:nowrap!important; overflow:visible!important; flex-grow:1!important; text-align:left!important; display:block!important; margin:0!important; padding:0!important; line-height:1.2!important;">
                      <b>${peso(h.amount)}</b> on ${esc(formatDisplayDate(h.date))}
                    </span>
                    <div class="cf-history-entry-actions-group" style="display:flex!important; align-items:center!important; justify-content:flex-end!important; flex-shrink:0!important; margin-left:14px!important;">
                      <button type="button" class="cf-minimalist-del-action-btn" data-action="overlay-delete-pay" data-idx="${realIdx}" style="background:none!important; border:none!important; color:#dc2626!important; font-weight:600!important; font-size:11px!important; text-transform:uppercase!important; letter-spacing:0.3px!important; cursor:pointer!important; padding:4px 6px!important; margin:0!important; line-height:1!important; box-shadow:none!important; height:auto!important; min-height:0!important; width:auto!important;">DEL</button>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");

  // Re-attach target touch interaction listeners natively to layout nodes
  target.querySelectorAll('[data-overlay-cf-name]').forEach(card => {
    const sName = card.getAttribute('data-overlay-cf-name');
    
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      toggleClassFundDetail(encodeURIComponent(sName));
    });

    const addPay = card.querySelector('[data-action="overlay-add-pay"]');
    if (addPay) {
      addPay.addEventListener('click', (e) => {
        e.stopPropagation();
        openClassFundPaymentModal(sName);
      });
    }

    card.querySelectorAll('[data-action="overlay-delete-pay"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteClassFundPayment(sName, parseInt(btn.getAttribute('data-idx'), 10));
      });
    });
  });
}


// Active context tracker global memory value
window.__activeRemitManagerCategory = "";

function openCollectionRemittanceManager(categoryName) {
  const catObj = db.categories[categoryName];
  if (!catObj) return;

  // Establish state parameters into tracking registers
  window.__activeRemitManagerCategory = categoryName;

  // Gather current target data models
  const currentStatus = catObj.remittanceStatus || "unremitted";
  const currentNotes = catObj.remittanceNotes || "";

  // Map values onto the modal controls
  const titleEl = document.getElementById("remit-modal-cat-title");
  const statusEl = document.getElementById("remit-modal-status");
  const notesEl = document.getElementById("remit-modal-notes");
  const modalOverlay = document.getElementById("remit-manager-modal");

  if (titleEl) titleEl.innerText = `Category: ${categoryName}`;
  if (statusEl) statusEl.value = currentStatus;
  if (notesEl) notesEl.value = currentNotes;

  // Reveal the modal layer container fluidly matching theme overlay transitions
  if (modalOverlay) {
    modalOverlay.style.display = "flex";
    modalOverlay.classList.add("is-active");
    document.body.style.overflow = "hidden"; // Block background document scrolling frames
  }
}

function closeRemitManagerModal() {
  const modalOverlay = document.getElementById("remit-manager-modal");
  if (modalOverlay) {
    modalOverlay.style.display = "none";
    modalOverlay.classList.remove("is-active");
    document.body.style.overflow = ""; // Reactivate baseline viewport scrollers
  }
  window.__activeRemitManagerCategory = "";
}

function saveCollectionRemittanceData() {
  const categoryName = window.__activeRemitManagerCategory;
  const catObj = db.categories[categoryName];
  if (!categoryName || !catObj) return closeRemitManagerModal();

  const selectedStatus = document.getElementById("remit-modal-status").value;
  const selectedDate = document.getElementById("remit-modal-date")?.value || new Date().toISOString().slice(0, 10);
  const enteredNotes = document.getElementById("remit-modal-notes").value.trim();

  // 1. CONDITION A: Toggling "ON" to REMITTED
  if (selectedStatus === "remitted" && catObj.remittanceStatus !== "remitted") {
    const totalCollectedAmount = round2(catObj.records.reduce((sum, r) => sum + (Number(r.paid) || 0), 0));

    if (totalCollectedAmount > 0) {
      const transactionId = "REM-LOG-" + Date.now() + "-" + Math.floor(Math.random() * 1000);

      // Changed category from "Year-Level Remittance Logs" to "Year-Level Remitted"
      db.cashbook.transactions.push({
        id: transactionId,
        type: "remittance",              
        date: selectedDate, 
        orNumber: "",
        category: "Year-Level Remitted", 
        description: `Remittance from ${categoryName} — Turnover of all collected funds`, 
        amount: totalCollectedAmount,
        projectId: null,
        notes: enteredNotes || "Automated turnover entry recorded on collection closeout."
      });
    }
  } 
  // 2. CONDITION B: Toggling "OFF" back to UNREMITTED
  else if (selectedStatus !== "remitted" && catObj.remittanceStatus === "remitted") {
    if (db.cashbook && Array.isArray(db.cashbook.transactions)) {
      db.cashbook.transactions = db.cashbook.transactions.filter(t => {
        // Extended criteria to successfully drop both legacy and newly saved "Year-Level Remitted" logs
        const isRemitLog = t.type === "remittance" || 
                           t.category === "Year-Level Remittance Logs" || 
                           t.category === "Year-Level Remitted";
        const isMatchDesc = t.description && t.description.includes(`Remittance from ${categoryName} — Turnover`);
        return !(isRemitLog && isMatchDesc);
      });
    }
  }

  // Update object data settings
  catObj.remittanceStatus = selectedStatus;
  catObj.remittanceDate = selectedDate;
  catObj.remittanceNotes = enteredNotes;

  saveData();
  closeRemitManagerModal();

  // 🌟 FORCE REAL-TIME RENDERING SYNCHRONIZATION
  renderSummary();          // <-- Instantly live updates the TOTAL COLLECTED dashboard block 
  renderCategories();       // <-- Instantly updates list rows and dots on the screen
  renderCashbookSummary();   
  renderCashbookList();
  
  if (typeof renderCashbookLog === "function") renderCashbookLog(); 
  if (typeof renderEveSummary === "function") renderEveSummary();
}










// Intercept clicks directly onto the outside blurred backdrop layer to close out modals instantly
document.addEventListener('DOMContentLoaded', () => {
  const remitModal = document.getElementById('remit-manager-modal');
  if (remitModal) {
    remitModal.addEventListener('click', (e) => {
      if (e.target === remitModal) {
        closeRemitManagerModal();
      }
    });
  }
});


function closeClassFundPaymentModal() {
  const modal = document.getElementById("cf-payment-modal");
  if (modal) {
    modal.classList.add("hidden");
  }
}


/* =========================================================================
   GLOBAL AUTO-CLEAR ON SAVE/SUBMIT INTERCEPTOR
   ========================================================================= */
document.addEventListener("click", function (event) {
  // 1. Identify if the clicked element is a save, confirm, record, or submit button
  const btn = event.target.closest("button, input[type='submit']");
  if (!btn) return;

  const btnText = (btn.innerText || btn.value || "").toLowerCase();
  const btnClass = btn.className.toLowerCase();
  const onClickAttr = (btn.getAttribute("onclick") || "").toLowerCase();

  // Targets buttons containing save, record, confirm, submit, quick pay, or add
  const isSaveAction = 
    btnText.includes("save") || 
    btnText.includes("record") || 
    btnText.includes("confirm") || 
    btnText.includes("submit") || 
    btnText.includes("pay") ||
    btnClass.includes("btn-save") ||
    onClickAttr.includes("save") || 
    onClickAttr.includes("record") ||
    onClickAttr.includes("submit");

  // Skip cancel or delete buttons entirely
  const isExempt = btnText.includes("cancel") || btnText.includes("del") || btnClass.includes("delete");

  if (isSaveAction && !isExempt) {
    // 2. We use a 100ms delay loop to let your active save functions read the text boxes first
    setTimeout(() => {
      // Find the container layer (form, card, or modal section) the button lives in
      const contextParent = btn.closest(".record-payment-box, .cashbook-record-box, .modal-content, .card, .item-row, .cf-settings, .cf-expense-card, .page");
      const targetArea = contextParent || document;

      // 3. Select all inputs within this container boundary
      const inputs = targetArea.querySelectorAll("input:not([type='button']):not([type='submit']):not([type='checkbox']):not([type='radio']), textarea, select");
      
      inputs.forEach(input => {
        // Skip hidden fields (like edit IDs) and keep date pickers persistent so the user doesn't re-type dates
        if (input.type === "hidden" || input.id.includes("id") || input.type === "date" || input.id.includes("date")) {
          return;
        }

        // Safely clear the data channel fields cleanly
        input.value = "";
        
        // Fire a synthetic input event so frameworks or search dropdowns know the field was emptied
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }, 100);
  }
});


  // =========================================================================
  // GLOBAL CLICK DISMISSER FOR SEARCHABLE DROPDOWNS
  // =========================================================================
  window.addEventListener("click", function (event) {
    function closeIfOutside(searchSelector, dropdownId) {
      const dropdown = document.getElementById(dropdownId);
      if (!dropdown) return;
      
      const clickedInside = event.target.closest(searchSelector) || event.target.closest(`#${dropdownId}`);
      if (!clickedInside) {
        dropdown.classList.remove("show");
      }
    }

    // 1. Existing payment and project fields
    closeIfOutside('#category-search', 'category-list-dropdown');
    closeIfOutside('#student-search', 'student-list-dropdown');
    closeIfOutside('#txn-project-search', 'txn-project-dropdown');

    // 2. Remittance Collection dropdown
    closeIfOutside('#add-remittance-collection-search', 'add-remittance-collection-dropdown');

    // 3. Remittance Year Level dropdown
    closeIfOutside('#add-remittance-year-level-search', 'add-remittance-year-level-dropdown');
  });

  // Global event listener to dismiss "Show Status" popovers when tapping anywhere outside
['click', 'touchstart'].forEach(eventType => {
  document.addEventListener(eventType, function (e) {
    // If clicking the button or inside the popover, let the inline stopPropagation handle it
    if (e.target.closest('.floating-status-popover') || (e.target.tagName === 'BUTTON' && e.target.innerText.includes('Show Status'))) {
      return;
    }
    
    // Reset all popovers to hidden and reset their parent row z-index layering
    document.querySelectorAll('.floating-status-popover').forEach(pop => {
      pop.style.setProperty('display', 'none', 'important');
    });
    document.querySelectorAll('.item-row').forEach(row => {
      row.style.setProperty('z-index', '5', 'important');
    });
  }, { passive: true });
});


/* Data button removal + Summary tab are now wired directly in index.html
   (#nav-summary-tab / #eve-summary-tab-section) and in switchTab() above. */


   function calcInput(v) {
  if (calcExpression === "0" && v !== ".") calcExpression = "";
  calcExpression += v;
  document.getElementById("calc-display").innerText = calcExpression || "0";
}

function calcEqual() {
  if (!calcExpression || calcExpression === "Err") return;
  try {
    // Convert visual display operators into valid standard JavaScript math operators
    let standardExpression = calcExpression.replace(/×/g, "*").replace(/÷/g, "/");
    
    // Sanitize to only permit numbers and safe operators
    const safe = standardExpression.replace(/[^0-9+\-*/.]/g, "");
    if (!safe) return;

    const res = Function('"use strict"; return (' + safe + ')')();
    calcExpression = String(Math.round((res + Number.EPSILON) * 100) / 100);
    document.getElementById("calc-display").innerText = calcExpression;
  } catch (e) { 
    calcExpression = "";
    document.getElementById("calc-display").innerText = "Err"; 
  }
}


function openEveNotes() {
  // Wipe out competing background interface cards fluidly
  _hideAllInteriorInventoryViews();

  const notesModal = document.getElementById("eve-notes-overlay");
  if (notesModal) {
    notesModal.classList.remove("hidden");
    notesModal.classList.add("is-active");
    notesModal.style.setProperty('display', 'flex', 'important');
    document.body.style.overflow = "hidden";
  } else {
    // Fallback support for structural variance
    const view = document.getElementById("eve-notes-view");
    if (view) view.classList.remove("hidden");
  }
  
  // Ensure the action create button remains visible on main screen launch
  const btn = document.getElementById("notes-plus-btn");
  if (btn) btn.classList.remove("hidden");

  if (typeof renderNotesList === "function") {
    renderNotesList();
  }
  _lockEveCompanionVisualGaze();
}

function backToNoteList() {
  const editor = document.getElementById("notes-editor");
  if (editor) editor.classList.add("hidden");
  
  const folderList = document.getElementById("notes-folder-list");
  if (folderList) folderList.classList.remove("hidden");
  
  const btn = document.getElementById("notes-plus-btn");
  if (btn) btn.classList.remove("hidden");
  
  renderNotesList();
}


/* =========================================================================
   TOP-BAR FULL-SCREEN CALCULATOR + NOTES BUTTONS
   Uses the existing calculator state and db.notepad storage above.
   ========================================================================= */
(function wireUtilityOverlays() {
  function setCalcDisplays(value) {
    document.querySelectorAll("#calc-display").forEach(el => {
      el.innerText = value || "0";
    });
  }

  window.openCalcModal = function () {
    const overlay = document.getElementById("eve-calc-overlay");
    if (!overlay) return;
    overlay.classList.remove("hidden");
    overlay.style.setProperty("display", "flex", "important");
    document.body.style.overflow = "hidden";
    setCalcDisplays(calcExpression);
  };

  window.closeCalcModal = window.closeEveCalcModal = function () {
    const overlay = document.getElementById("eve-calc-overlay");
    if (overlay) {
      overlay.classList.add("hidden");
      overlay.style.removeProperty("display");
    }
    document.body.style.overflow = "";
  };

  window.calcInput = function (value) {
    if (calcExpression === "Err") calcExpression = "";
    if (calcExpression === "0" && value !== ".") calcExpression = "";
    const last = calcExpression.slice(-1);
    if (/^[+*/-]$/.test(value) && /^[+*/-]$/.test(last)) {
      calcExpression = calcExpression.slice(0, -1);
    }
    if (value === "." && /(?:^|[+*/-])\d*\.\d*$/.test(calcExpression)) return;
    calcExpression += value;
    setCalcDisplays(calcExpression);
  };

  window.calcClear = function () {
    calcExpression = "";
    setCalcDisplays("0");
  };

  window.calcBack = function () {
    calcExpression = calcExpression.slice(0, -1);
    setCalcDisplays(calcExpression);
  };

  window.calcEqual = function () {
    const expression = String(calcExpression || "").trim();
    if (!expression) return;
    if (!/^[0-9+*/.()\-\s]+$/.test(expression)) {
      calcExpression = "Err";
      setCalcDisplays(calcExpression);
      return;
    }
    try {
      const result = Function('"use strict"; return (' + expression + ")")();
      if (!Number.isFinite(result)) throw new Error("Invalid result");
      calcExpression = String(Math.round((result + Number.EPSILON) * 100) / 100);
    } catch (error) {
      calcExpression = "Err";
    }
    setCalcDisplays(calcExpression);
  };

  window.openNotesModal = function () {
    const overlay = document.getElementById("eve-notes-overlay");
    if (!overlay) return;
    overlay.classList.remove("hidden");
    overlay.classList.add("is-active");
    overlay.style.setProperty("display", "flex", "important");
    document.body.style.overflow = "hidden";
    if (typeof renderNotesList === "function") renderNotesList();
  };

  window.closeNotesModal = window.closeEveNotesModal = function () {
    // Discard any unsaved edit in progress and reset back to the list view
    // (also restores the "+ New Note" button, which hides while editing).
    if (typeof backToNoteList === "function") {
      backToNoteList();
    } else {
      document.getElementById("notes-editor")?.classList.add("hidden");
      document.getElementById("notes-folder-list")?.classList.remove("hidden");
      document.getElementById("notes-plus-btn")?.classList.remove("hidden");
    }
    const overlay = document.getElementById("eve-notes-overlay");
    if (overlay) {
      overlay.classList.add("hidden");
      overlay.classList.remove("is-active");
      overlay.style.removeProperty("display");
    }
    document.body.style.overflow = "";
  };

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const calc = document.getElementById("eve-calc-overlay");
    const notes = document.getElementById("eve-notes-overlay");
    if (calc && !calc.classList.contains("hidden")) window.closeCalcModal();
    else if (notes && !notes.classList.contains("hidden")) window.closeNotesModal();
  });
})();

/* Fix: the full-screen EVE notes button opens the existing database editor directly. */
window.createNewNoteFlow = function () {
  if (typeof db === "undefined") {
    console.error("Notes database is not initialized yet.");
    return;
  }

  if (!db.notepad) db.notepad = { notes: [] };
  const id = Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  db.notepad.notes.push({
    id,
    title: "New Note",
    content: "",
    updated: new Date().toISOString().slice(0, 10)
  });

  if (typeof saveData === "function") saveData();

  if (typeof openNoteEditor === "function") {
    openNoteEditor(id);
  } else {
    document.getElementById("notes-folder-list")?.classList.add("hidden");
    document.getElementById("notes-editor")?.classList.remove("hidden");
    document.getElementById("note-editor-title").value = "New Note";
    document.getElementById("note-editor-body").value = "";
  }
};





/* =========================================================================
   CONTEXTUAL LIGHT-BULB HELP
   Eve speaks only when the user asks for help on a specific feature.
   ========================================================================= */
(function initFeatureTips() {
  const tips = {
    "records-add": "Add Collection creates a new money-collection tracker. Enter a clear collection name (e.g. SSC Fee), then enter the amount expected from each student. Tap Add Collection to save it.",
    "records-list": "Collections A-Z shows every collection you have created. Use the letter index to jump quickly, then tap a collection card to open its details. The red status circle is used when a collection has been remitted.",
    "collection-details": "Inside a collection you can add all saved students, search names, filter payment status, record payments, use Quick Pay, rename the collection, and export its records as CSV.",
    "students-add": "Add student or year-level names here once. Separate multiple names with commas, then tap Add Year Level. These permanent names can be reused in every new collection and in Class Fund.",
    "students-list": "Student Database is your permanent list. Add student names first then search to look for the students' names, then tap a student or year level to view balances across collections. Keep this list updated before using Add All Students.",
    "students-breakdown": "Breakdown By Collection shows how this student is doing in every collection: the amount due, payments already recorded, and any remaining balance. Use it to answer questions quickly.",
    "students-roster": "Open Students Database to manage the detailed roster for this program or year level. Search names, add several names separated by commas, and keep the list accurate before recording payments.",
    "cashbook-summary": "Cashbook Overview shows the live financial totals: opening balance, income, expenses, remittances, and cash on hand. These figures update whenever you save a transaction.",
    "cashbook-opening": "Opening Balance is the cash already on hand before you began using this app. Enter that starting amount once; use zero when there was no starting cash.",
    "projects": "Projects and Events help you track a separate budget, such as Student Week. Add a project name and optional budget, then link related cashbook transactions to it.",
    "transaction": "Record every money movement here. Choose Income or Expense, select the date, enter a clear description and amount, optionally link a project, then tap Save Transaction.",
    "transaction-logs": "Transaction Logs lets you review all income and expenses. Open a log to search entries, inspect details, edit or delete a transaction, and export the displayed log as CSV.",
    "statement": "Generate Statement creates a formal report for a selected date range. Complete Organization Information first, choose the start and end dates, then generate or view the statement full screen.",
    "classfund-settings": "Class Fund tracks a repeated weekly contribution per student. Enter the weekly due amount and the date tracking began, then tap Save Settings before enrolling students.",
    "student-collections": "Student Collections shows each enrolled student’s expected amount, paid amount, missed weeks, and payment history. Tap a student card to expand it and record a payment.",
    "classfund-ledger": "Class Fund Ledger is the complete money trail for the fund. Use its filters to view all entries, income only, or expenses only. Open an entry to review or manage it.",
    "summary": "Summary is your quick dashboard. Compare what should have been collected with what was actually collected, review unpaid balances, and check remittance progress before reporting.",
    "backup": "Backup protects your work. Export a JSON backup regularly, especially after collection days or before changing devices. Import that file to restore your records; Reset All Data permanently erases them."
  };

  window.showFeatureTip = function(key) {
    const message = tips[key] || "Use this feature to record, organize, and review your treasurer records. Tap the light bulb beside any feature for a more specific explanation.";
    
    // 🌟 SAFELY USES NATIVE ENGINE WITH CURRENT SMILING POSTURE CONSTRAINTS
    if (window.EveAssistant && typeof window.EveAssistant.showMsg === "function") {
      window.EveAssistant.showMsg(message, false, 'smile', 12000); 
    } else if (typeof eveAlert === "function") {
      eveAlert(message);
    }
  };
})();

