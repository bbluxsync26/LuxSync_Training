(function () {
  "use strict";

  var API = "/api";
  var HOSTS = ["luxsync.xyz", "www.luxsync.xyz"];
  var state = {
    ready: false,
    hydrating: false,
    user: null,
    progress: {},
    legacyProgress: {},
    stats: { completed: 0, total: 11, percent: 0, streak: 0 },
    lastSynced: null,
    syncTimer: null,
    online: false
  };

  var originalGetProgress = window.getProgress;
  var originalSaveProgress = window.saveProgress;
  var originalGetSimHistory = window.getSimHistory;
  var originalSaveSimHistory = window.saveSimHistory;

  function localProgress() {
    try {
      return originalGetProgress ? originalGetProgress() : JSON.parse(localStorage.getItem("luxsync_progress") || "{}");
    } catch (error) {
      return {};
    }
  }

  function writeLocalProgress(progress) {
    if (originalSaveProgress) {
      originalSaveProgress(progress);
    } else {
      localStorage.setItem("luxsync_progress", JSON.stringify(progress));
    }
  }

  function api(path, options) {
    var requestOptions = options || {};
    requestOptions.credentials = "same-origin";
    requestOptions.headers = Object.assign({ "Content-Type": "application/json" }, requestOptions.headers || {});
    return fetch(API + path, requestOptions).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(body.error || "Request failed (" + response.status + ")");
        });
      }
      return response.status === 204 ? null : response.json();
    });
  }

  function isSecureHost() {
    return HOSTS.indexOf(window.location.hostname.toLowerCase()) !== -1;
  }

  function humanize(key) {
    return String(key)
      .replace(/[-_]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function completedKeys(progress) {
    return Object.keys(progress || {}).filter(function (key) {
      return progress[key] === true && key !== "lastModule";
    });
  }

  function calculateStats(progress, serverStats) {
    var completed = completedKeys(progress).length;
    var total = serverStats && serverStats.total ? serverStats.total : 11;
    return {
      completed: completed,
      total: total,
      percent: Math.min(100, Math.round((completed / total) * 100)),
      streak: serverStats && serverStats.streak ? serverStats.streak : 0
    };
  }

  function setStatus(kind, label) {
    var dot = document.getElementById("luxsync-sync-dot");
    var text = document.getElementById("luxsync-sync-label");
    if (!dot || !text) return;
    var colors = {
      online: "#7ba891",
      syncing: "#d0beb0",
      offline: "#c47878",
      local: "#7b96b2"
    };
    dot.style.background = colors[kind] || colors.local;
    dot.style.boxShadow = "0 0 12px " + (colors[kind] || colors.local);
    text.textContent = label;
  }

  function updateInterface() {
    var email = state.user && state.user.email ? state.user.email : "Local browser";
    var userEmail = document.getElementById("luxsync-user-email");
    var percent = document.getElementById("luxsync-record-percent");
    var bar = document.getElementById("luxsync-record-bar");
    var modules = document.getElementById("luxsync-record-modules");
    var streak = document.getElementById("luxsync-record-streak");
    var synced = document.getElementById("luxsync-record-synced");
    var importArea = document.getElementById("luxsync-import-area");

    state.stats = calculateStats(state.progress, state.stats);

    if (userEmail) userEmail.textContent = email;
    if (percent) percent.textContent = state.stats.percent + "%";
    if (bar) bar.style.width = state.stats.percent + "%";
    if (streak) streak.textContent = String(state.stats.streak || 0);
    if (synced) synced.textContent = state.lastSynced ? new Date(state.lastSynced).toLocaleString() : "Not yet";

    if (modules) {
      var keys = completedKeys(state.progress);
      if (!keys.length) {
        modules.innerHTML = '<div style="padding:18px;border:1px dashed rgba(208,190,176,.28);border-radius:12px;color:#9e8b85;text-align:center;">No modules completed yet.</div>';
      } else {
        modules.innerHTML = keys.map(function (key) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:rgba(123,168,145,.08);border:1px solid rgba(123,168,145,.18);">' +
            '<span style="width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#7ba891;color:#0d1526;font-weight:800;">&#10003;</span>' +
            '<span style="color:#f1ece8;font-size:13px;">' + humanize(key) + '</span></div>';
        }).join("");
      }
    }

    var legacyCount = completedKeys(state.legacyProgress).length;
    if (importArea) {
      importArea.style.display = state.online && legacyCount > 0 && completedKeys(state.progress).length === 0 ? "block" : "none";
      var importText = document.getElementById("luxsync-import-text");
      if (importText) importText.textContent = legacyCount + " completed module" + (legacyCount === 1 ? "" : "s") + " found in this browser.";
    }

    var dashStreak = document.getElementById("dash-streak");
    if (dashStreak && state.online) {
      dashStreak.textContent = (state.stats.streak || 0) + ((state.stats.streak || 0) === 1 ? " day" : " days");
    }
  }

  function queueSync(progress) {
    if (!state.online || state.hydrating) return;
    clearTimeout(state.syncTimer);
    setStatus("syncing", "Saving progress");
    state.syncTimer = setTimeout(function () {
      api("/progress", {
        method: "PUT",
        body: JSON.stringify({ progress: progress })
      }).then(function (result) {
        state.lastSynced = result.updatedAt || new Date().toISOString();
        state.stats = calculateStats(progress, result.stats);
        setStatus("online", "Progress synced");
        updateInterface();
      }).catch(function () {
        setStatus("offline", "Saved locally — sync pending");
      });
    }, 350);
  }

  window.getProgress = function () {
    return state.ready ? state.progress : localProgress();
  };

  window.saveProgress = function (progress) {
    state.progress = progress || {};
    writeLocalProgress(state.progress);
    updateInterface();
    queueSync(state.progress);
  };

  window.getSimHistory = function () {
    try {
      return originalGetSimHistory ? originalGetSimHistory() : JSON.parse(sessionStorage.getItem("luxsync_sim_history") || "[]");
    } catch (error) {
      return [];
    }
  };

  window.saveSimHistory = function (history) {
    if (originalSaveSimHistory) {
      originalSaveSimHistory(history);
    } else {
      sessionStorage.setItem("luxsync_sim_history", JSON.stringify(history || []));
    }
    if (state.online && !state.hydrating && history && history[0]) {
      api("/simulator-attempts", {
        method: "POST",
        body: JSON.stringify(history[0])
      }).catch(function () {
        setStatus("offline", "Simulation saved locally");
      });
    }
  };

  function createInterface() {
    var style = document.createElement("style");
    style.textContent =
      "#luxsync-record-launch{position:fixed;right:18px;bottom:18px;z-index:9998;border:1px solid rgba(208,190,176,.28);border-radius:999px;background:rgba(13,21,38,.94);color:#f1ece8;padding:10px 15px;display:flex;align-items:center;gap:9px;box-shadow:0 16px 42px rgba(0,0,0,.38);backdrop-filter:blur(14px);font:600 12px Manrope,Arial,sans-serif;cursor:pointer}" +
      "#luxsync-record-launch:hover{border-color:#7b96b2;transform:translateY(-1px)}" +
      "#luxsync-record-overlay{display:none;position:fixed;inset:0;z-index:9999;background:rgba(5,9,18,.76);backdrop-filter:blur(8px);padding:20px;overflow:auto}" +
      "#luxsync-record-panel{width:min(680px,100%);margin:4vh auto;background:linear-gradient(145deg,#172036,#0d1526);border:1px solid rgba(208,190,176,.24);border-radius:20px;box-shadow:0 30px 90px rgba(0,0,0,.55);color:#f1ece8;font-family:Manrope,Arial,sans-serif;overflow:hidden}" +
      ".luxsync-record-stat{padding:14px;border:1px solid rgba(123,150,178,.16);background:rgba(123,150,178,.07);border-radius:12px;text-align:center}" +
      ".luxsync-record-button{border:1px solid rgba(123,150,178,.38);background:rgba(123,150,178,.15);color:#f1ece8;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer}" +
      ".luxsync-record-button:hover{background:rgba(123,150,178,.26)}" +
      "@media(max-width:560px){#luxsync-record-launch{right:12px;bottom:12px}#luxsync-record-panel{margin:0 auto}.luxsync-record-grid{grid-template-columns:1fr!important}}";
    document.head.appendChild(style);

    var launch = document.createElement("button");
    launch.id = "luxsync-record-launch";
    launch.type = "button";
    launch.innerHTML = '<span id="luxsync-sync-dot" style="width:8px;height:8px;border-radius:50%;background:#7b96b2;"></span><span id="luxsync-sync-label">Connecting progress</span>';
    document.body.appendChild(launch);

    var overlay = document.createElement("div");
    overlay.id = "luxsync-record-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "luxsync-record-title");
    overlay.innerHTML =
      '<div id="luxsync-record-panel">' +
        '<div style="padding:22px 24px;border-bottom:1px solid rgba(208,190,176,.16);display:flex;justify-content:space-between;gap:16px;align-items:flex-start;">' +
          '<div><div style="font-size:10px;letter-spacing:2.3px;text-transform:uppercase;color:#7b96b2;font-weight:800;">LuxSync Academy</div>' +
          '<h2 id="luxsync-record-title" style="font-size:22px;margin:5px 0 3px;">My Learning Record</h2>' +
          '<div id="luxsync-user-email" style="font-size:12px;color:#9e8b85;">Connecting...</div></div>' +
          '<button id="luxsync-record-close" type="button" aria-label="Close learning record" style="border:0;background:transparent;color:#d0beb0;font-size:26px;cursor:pointer;">&times;</button>' +
        '</div>' +
        '<div style="padding:24px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:end;margin-bottom:8px;"><span style="font-size:12px;color:#d0beb0;">Overall completion</span><strong id="luxsync-record-percent" style="font-size:24px;color:#7b96b2;">0%</strong></div>' +
          '<div style="height:9px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden;"><div id="luxsync-record-bar" style="height:100%;width:0;background:linear-gradient(90deg,#7b96b2,#7ba891);border-radius:999px;transition:width .4s ease;"></div></div>' +
          '<div class="luxsync-record-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0;">' +
            '<div class="luxsync-record-stat"><div id="luxsync-record-streak" style="font-size:22px;font-weight:800;color:#d0beb0;">0</div><div style="font-size:10px;color:#9e8b85;text-transform:uppercase;letter-spacing:1px;">Day streak</div></div>' +
            '<div class="luxsync-record-stat"><div id="luxsync-record-complete" style="font-size:22px;font-weight:800;color:#d0beb0;">11</div><div style="font-size:10px;color:#9e8b85;text-transform:uppercase;letter-spacing:1px;">Modules total</div></div>' +
            '<div class="luxsync-record-stat"><div style="font-size:12px;font-weight:700;color:#d0beb0;margin:6px 0;" id="luxsync-record-synced">Not yet</div><div style="font-size:10px;color:#9e8b85;text-transform:uppercase;letter-spacing:1px;">Last synced</div></div>' +
          '</div>' +
          '<div id="luxsync-import-area" style="display:none;padding:14px;border-radius:12px;background:rgba(208,190,176,.08);border:1px solid rgba(208,190,176,.22);margin-bottom:18px;">' +
            '<div id="luxsync-import-text" style="font-size:12px;color:#d0beb0;margin-bottom:10px;"></div>' +
            '<button id="luxsync-import-progress" class="luxsync-record-button" type="button">Import progress from this browser</button>' +
          '</div>' +
          '<h3 style="font-size:11px;text-transform:uppercase;letter-spacing:1.8px;color:#9e8b85;margin:0 0 10px;">Completed modules</h3>' +
          '<div id="luxsync-record-modules" style="display:grid;gap:8px;"></div>' +
          '<div id="luxsync-secure-link" style="display:none;margin-top:18px;padding:13px;border-radius:10px;background:rgba(196,120,120,.08);border:1px solid rgba(196,120,120,.2);font-size:12px;color:#d0beb0;">Progress synchronization is available through <a href="https://luxsync.xyz" style="color:#7b96b2;font-weight:800;">luxsync.xyz</a>.</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    launch.addEventListener("click", function () {
      overlay.style.display = "block";
      updateInterface();
    });
    document.getElementById("luxsync-record-close").addEventListener("click", function () {
      overlay.style.display = "none";
    });
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) overlay.style.display = "none";
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") overlay.style.display = "none";
    });
    document.getElementById("luxsync-import-progress").addEventListener("click", function () {
      state.progress = Object.assign({}, state.legacyProgress);
      state.legacyProgress = {};
      writeLocalProgress(state.progress);
      updateInterface();
      queueSync(state.progress);
      if (typeof window.updateProgress === "function") window.updateProgress();
      if (typeof window.updateDashboard === "function") window.updateDashboard();
    });
  }

  function hydrate() {
    createInterface();
    state.legacyProgress = localProgress();

    if (!isSecureHost()) {
      state.progress = state.legacyProgress;
      state.ready = true;
      setStatus("local", "Local progress only");
      var link = document.getElementById("luxsync-secure-link");
      if (link) link.style.display = "block";
      updateInterface();
      return;
    }

    Promise.all([api("/me"), api("/progress"), api("/simulator-attempts")])
      .then(function (results) {
        state.user = results[0].user;
        state.online = true;
        state.hydrating = true;

        var remoteProgress = results[1].progress || {};
        state.progress = remoteProgress;
        state.stats = results[1].stats || state.stats;
        state.lastSynced = results[1].updatedAt || null;
        writeLocalProgress(remoteProgress);

        var remoteHistory = results[2].attempts || [];
        if (remoteHistory.length && originalSaveSimHistory) {
          originalSaveSimHistory(remoteHistory);
        }

        state.ready = true;
        state.hydrating = false;
        setStatus("online", "Progress synced");
        updateInterface();

        if (typeof window.updateProgress === "function") window.updateProgress();
        if (typeof window.updateDashboard === "function") window.updateDashboard();
        if (typeof window.renderSimHistory === "function") window.renderSimHistory();
      })
      .catch(function (error) {
        state.progress = state.legacyProgress;
        state.ready = true;
        state.online = false;
        setStatus("offline", "Local mode — API unavailable");
        updateInterface();
        console.warn("LuxSync progress API:", error.message);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrate);
  } else {
    hydrate();
  }
})();