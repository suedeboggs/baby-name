(() => {
  const USER_LABELS = { marie: "Marie", jimmy: "Jimmy" };

  const screens = {
    login: document.getElementById("screen-login"),
    welcome: document.getElementById("screen-welcome"),
    swipe: document.getElementById("screen-swipe"),
    results: document.getElementById("screen-results"),
  };

  const els = {
    currentUserLabel: document.getElementById("current-user-label"),
    welcomeUserLabel: document.getElementById("welcome-user-label"),
    btnStartSwiping: document.getElementById("btn-start-swiping"),
    roundBadge: document.getElementById("round-badge"),
    roundMenu: document.getElementById("round-menu"),
    progressFill: document.getElementById("progress-fill"),
    progressLabel: document.getElementById("progress-label"),
    cardEmpty: document.getElementById("card-empty"),
    emptyEmoji: document.getElementById("empty-emoji"),
    emptyMessage: document.getElementById("empty-message"),
    btnEmptyAction: document.getElementById("btn-empty-action"),
    card: document.getElementById("card"),
    cardCategory: document.getElementById("card-category"),
    cardName: document.getElementById("card-name"),
    cardPronunciation: document.getElementById("card-pronunciation"),
    cardAltSpellings: document.getElementById("card-alt-spellings"),
    stampLike: document.querySelector(".stamp-like"),
    stampNope: document.querySelector(".stamp-nope"),
    stampMaybe: document.querySelector(".stamp-maybe"),
    btnLike: document.getElementById("btn-like"),
    btnDislike: document.getElementById("btn-dislike"),
    btnUndo: document.getElementById("btn-undo"),
    btnResults: document.getElementById("btn-results"),
    btnSwitchUser: document.getElementById("btn-switch-user"),
    btnBackToSwipe: document.getElementById("btn-back-to-swipe"),
    btnCurrentResults: document.getElementById("btn-current-results"),
    btnToggleAddName: document.getElementById("btn-toggle-add-name"),
    addNameForm: document.getElementById("add-name-form"),
    addNameInput: document.getElementById("add-name-input"),
    resultsRoundLabel: document.getElementById("results-round-label"),
  };

  let currentUser = localStorage.getItem("babyNamesUser") || null;
  let currentRound = 1;
  let state = null; // last /api/state response
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragCurrentX = 0;
  let dragCurrentY = 0;
  let pointerId = null;

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.add("hidden"));
    screens[name].classList.remove("hidden");
  }

  async function api(path, options) {
    const res = await fetch(path, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed: ${path}`);
    }
    return res.json();
  }

  function fetchState(user, round) {
    return api(`/api/state?user=${encodeURIComponent(user)}&round=${round}`);
  }

  function postVote(user, name, status, round) {
    return api("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, name, status, round }),
    });
  }

  function postUndo(user, round) {
    return api("/api/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, round }),
    });
  }

  function postAddName(user, name) {
    return api("/api/add-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, name }),
    });
  }

  function fetchRoundStatus() {
    return api("/api/round-status");
  }

  function postStartNextRound() {
    return api("/api/start-next-round", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  }

  function resetCardTransform() {
    els.card.style.transition = "none";
    els.card.style.transform = "translate(0, 0) rotate(0deg)";
    els.stampLike.style.opacity = 0;
    els.stampNope.style.opacity = 0;
    els.stampMaybe.style.opacity = 0;
  }

  function renderState(s) {
    state = s;
    currentRound = s.round;
    els.roundBadge.classList.toggle("hidden", s.round <= 1);
    els.roundBadge.textContent = `Round ${s.round}`;
    els.progressFill.style.width = s.total
      ? `${(s.votedCount / s.total) * 100}%`
      : "0%";
    els.progressLabel.textContent = `${s.votedCount} / ${s.total} reviewed`;
    els.btnUndo.disabled = !s.canUndo;
    els.btnUndo.style.opacity = s.canUndo ? 1 : 0.35;

    if (!s.card) {
      els.card.classList.add("hidden");
      els.cardEmpty.classList.remove("hidden");
      handleQueueExhausted();
    } else {
      els.cardEmpty.classList.add("hidden");
      els.card.classList.remove("hidden");
      els.cardName.textContent = s.card;

      const details = s.cardDetails || {};
      els.cardCategory.textContent = details.category || "";

      els.cardPronunciation.textContent = details.pronunciation
        ? `/ ${details.pronunciation} /`
        : "";

      const altSpellings = details.altSpellings || [];
      els.cardAltSpellings.textContent = altSpellings.length
        ? `also spelled: ${altSpellings.join(", ")}`
        : "";

      resetCardTransform();
    }
  }

  async function loadState() {
    const s = await fetchState(currentUser, currentRound);
    renderState(s);
  }

  function showEmptyState(emoji, message, actionLabel, actionHandler) {
    els.emptyEmoji.textContent = emoji;
    els.emptyMessage.textContent = message;
    if (actionLabel) {
      els.btnEmptyAction.textContent = actionLabel;
      els.btnEmptyAction.classList.remove("hidden");
      els.btnEmptyAction.onclick = actionHandler;
    } else {
      els.btnEmptyAction.classList.add("hidden");
      els.btnEmptyAction.onclick = null;
    }
  }

  async function handleQueueExhausted() {
    let roundStatus;
    try {
      roundStatus = await fetchRoundStatus();
    } catch (err) {
      console.error("Couldn't check round status:", err);
      showEmptyState("🎉", "You've been through the whole list!", "See results", () => showResults());
      return;
    }

    if (currentRound < roundStatus.currentRound) {
      // A later round already exists (partner, or an earlier session, moved
      // things forward) -- just jump ahead to it.
      currentRound = roundStatus.currentRound;
      await loadState();
      return;
    }

    if (!roundStatus.currentRoundComplete) {
      showEmptyState(
        "⏳",
        `You're all caught up! Waiting for your partner to finish round ${roundStatus.currentRound}.`,
        "See results so far",
        () => showResults()
      );
      return;
    }

    if (roundStatus.nextRoundEligibleCount > 0) {
      showEmptyState(
        "🎉",
        `You've both finished round ${roundStatus.currentRound}! Ready to narrow down your ${roundStatus.nextRoundEligibleCount} matches and maybes?`,
        `Start Round ${roundStatus.currentRound + 1}`,
        startNextRound
      );
    } else {
      showEmptyState(
        "🏆",
        `You've both finished round ${roundStatus.currentRound}! Check out your results.`,
        "See results",
        () => showResults()
      );
    }
  }

  async function startNextRound() {
    els.btnEmptyAction.disabled = true;
    try {
      const result = await postStartNextRound();
      currentRound = result.round;
      await loadState();
    } catch (err) {
      console.error("Starting the next round failed:", err);
      alert("Couldn't start the next round — try again.");
    } finally {
      els.btnEmptyAction.disabled = false;
    }
  }

  async function vote(status) {
    if (!state || !state.card) return;
    const name = state.card;
    animateCardAway(status, async () => {
      try {
        const s = await postVote(currentUser, name, status, currentRound);
        renderState(s);
      } catch (err) {
        console.error("Vote failed, resyncing:", err);
        alert("That swipe didn't save — reloading your latest state.");
        await loadState();
      }
    });
  }

  function animateCardAway(status, onDone) {
    els.card.style.transition = "transform 0.35s ease";
    if (status === "liked") {
      els.card.style.transform = "translate(600px, -40px) rotate(30deg)";
    } else if (status === "disliked") {
      els.card.style.transform = "translate(-600px, -40px) rotate(-30deg)";
    } else {
      els.card.style.transform = "translate(0, 600px) rotate(0deg)";
    }
    setTimeout(onDone, 220);
  }

  async function undo() {
    if (!state || !state.canUndo) return;
    try {
      const s = await postUndo(currentUser, currentRound);
      renderState(s);
    } catch (err) {
      console.error("Undo failed:", err);
      alert("Undo didn't go through — try again.");
    }
  }

  // ---- Drag handling ----
  function onPointerDown(e) {
    if (!state || !state.card) return;
    dragging = true;
    pointerId = e.pointerId;
    els.card.setPointerCapture(pointerId);
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragCurrentX = e.clientX;
    dragCurrentY = e.clientY;
    els.card.style.transition = "none";
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    dragCurrentX = e.clientX;
    dragCurrentY = e.clientY;
    const dx = dragCurrentX - dragStartX;
    const dy = dragCurrentY - dragStartY;

    if (Math.abs(dx) >= Math.abs(dy)) {
      const rotate = dx / 12;
      els.card.style.transform = `translate(${dx}px, 0) rotate(${rotate}deg)`;
      els.stampLike.style.opacity = Math.max(0, Math.min(1, dx / 100));
      els.stampNope.style.opacity = Math.max(0, Math.min(1, -dx / 100));
      els.stampMaybe.style.opacity = 0;
    } else {
      els.card.style.transform = `translate(0, ${Math.max(0, dy)}px) rotate(0deg)`;
      els.stampLike.style.opacity = 0;
      els.stampNope.style.opacity = 0;
      els.stampMaybe.style.opacity = Math.max(0, Math.min(1, dy / 100));
    }
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    if (pointerId !== null) {
      els.card.releasePointerCapture(pointerId);
      pointerId = null;
    }
    const dx = dragCurrentX - dragStartX;
    const dy = dragCurrentY - dragStartY;
    const THRESHOLD = 100;

    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx > THRESHOLD) {
        vote("liked");
        return;
      } else if (dx < -THRESHOLD) {
        vote("disliked");
        return;
      }
    } else if (dy > THRESHOLD) {
      vote("maybe");
      return;
    }

    els.card.style.transition = "transform 0.25s ease";
    resetCardTransform();
  }

  function onPointerCancel() {
    if (!dragging) return;
    dragging = false;
    pointerId = null;
    els.card.style.transition = "transform 0.25s ease";
    resetCardTransform();
  }

  els.card.addEventListener("pointerdown", onPointerDown);
  els.card.addEventListener("pointermove", onPointerMove);
  els.card.addEventListener("pointerup", onPointerUp);
  els.card.addEventListener("pointercancel", onPointerCancel);

  document.addEventListener("keydown", (e) => {
    if (screens.swipe.classList.contains("hidden")) return;
    if (e.key === "ArrowRight") vote("liked");
    if (e.key === "ArrowLeft") vote("disliked");
    if (e.key === "ArrowDown") vote("maybe");
  });

  els.btnLike.addEventListener("click", () => vote("liked"));
  els.btnDislike.addEventListener("click", () => vote("disliked"));
  els.btnUndo.addEventListener("click", undo);

  // ---- Add a name ----
  els.btnToggleAddName.addEventListener("click", () => {
    els.addNameForm.classList.toggle("hidden");
    if (!els.addNameForm.classList.contains("hidden")) {
      els.addNameInput.focus();
    }
  });

  els.addNameForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = els.addNameInput.value.trim();
    if (!name) return;
    try {
      const s = await postAddName(currentUser, name);
      els.addNameInput.value = "";
      els.addNameForm.classList.add("hidden");
      renderState(s);
    } catch (err) {
      console.error("Add name failed:", err);
      alert("Couldn't add that name — try again.");
    }
  });

  // ---- Login ----
  document.querySelectorAll(".user-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentUser = btn.dataset.user;
      localStorage.setItem("babyNamesUser", currentUser);
      showWelcomeScreen();
    });
  });

  function showWelcomeScreen() {
    els.welcomeUserLabel.textContent = USER_LABELS[currentUser] || currentUser;
    showScreen("welcome");
  }

  els.btnStartSwiping.addEventListener("click", enterSwipeScreen);

  async function enterSwipeScreen() {
    els.currentUserLabel.textContent = USER_LABELS[currentUser] || currentUser;
    currentRound = 1;
    showScreen("swipe");
    await loadState();
  }

  els.btnSwitchUser.addEventListener("click", () => {
    currentUser = null;
    localStorage.removeItem("babyNamesUser");
    showScreen("login");
  });

  // ---- Round history menu ----
  els.roundBadge.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!els.roundMenu.classList.contains("hidden")) {
      els.roundMenu.classList.add("hidden");
      return;
    }
    let roundStatus;
    try {
      roundStatus = await fetchRoundStatus();
    } catch (err) {
      console.error("Couldn't load round history:", err);
      return;
    }
    els.roundMenu.innerHTML = roundStatus.availableRounds
      .map((r) => {
        const label = r === roundStatus.currentRound ? `Round ${r} (current)` : `Round ${r} results`;
        return `<button class="round-menu-item" data-round="${r}">${label}</button>`;
      })
      .join("");
    els.roundMenu.querySelectorAll(".round-menu-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = parseInt(btn.dataset.round, 10);
        els.roundMenu.classList.add("hidden");
        showResults(r === roundStatus.currentRound ? undefined : r);
      });
    });
    els.roundMenu.classList.remove("hidden");
  });

  document.addEventListener("click", (e) => {
    if (!els.roundMenu.contains(e.target) && e.target !== els.roundBadge) {
      els.roundMenu.classList.add("hidden");
    }
  });

  // ---- Results ----
  els.btnResults.addEventListener("click", () => showResults());
  els.btnCurrentResults.addEventListener("click", () => showResults());
  els.btnBackToSwipe.addEventListener("click", async () => {
    showScreen("swipe");
    await loadState();
  });

  async function showResults(round) {
    showScreen("results");
    const query = round ? `?round=${round}` : "";
    const data = await api(`/api/results${query}`);
    renderResults(data, round != null);
  }

  const MAYBE_LEVEL_LABELS = {
    "both-maybe": "Both Maybe",
    "maybe-yes": "One Maybe, One Yes",
    "maybe-no": "One Maybe, One No",
  };
  const MAYBE_LEVEL_ORDER = ["both-maybe", "maybe-yes", "maybe-no"];

  function renderResults(data, isHistorical) {
    els.resultsRoundLabel.textContent = isHistorical ? `Round ${data.round} (past)` : `Round ${data.round}`;
    els.btnCurrentResults.classList.toggle("hidden", !isHistorical);

    document.getElementById("count-matches").textContent = data.matches.length;
    document.getElementById("count-maybe").textContent = data.maybe.length;
    document.getElementById("count-onesided").textContent = data.oneSided.length;
    document.getElementById("count-disliked").textContent = data.bothDisliked.length;
    document.getElementById("count-pending").textContent = data.pending.length;

    fillList("list-matches", "empty-matches", data.matches, (name) => `<li>${escapeHtml(name)}</li>`);

    renderMaybeGroups(data.maybe);

    fillList("list-onesided", "empty-onesided", data.oneSided, (item) => {
      const likerLabel = USER_LABELS[item.liker];
      return `<li>${escapeHtml(item.name)} <span class="badge">${likerLabel} liked it</span></li>`;
    });

    fillList("list-disliked", "empty-disliked", data.bothDisliked, (name) => `<li>${escapeHtml(name)}</li>`);

    fillList("list-pending", "empty-pending", data.pending, (item) => {
      const waitingOn = [];
      if (item.marie === null || item.marie === undefined) waitingOn.push("Marie");
      if (item.jimmy === null || item.jimmy === undefined) waitingOn.push("Jimmy");
      return `<li>${escapeHtml(item.name)} <span class="badge">waiting on ${waitingOn.join(" & ")}</span></li>`;
    });
  }

  function renderMaybeGroups(items) {
    const container = document.getElementById("list-maybe");
    const emptyEl = document.getElementById("empty-maybe");
    if (!items.length) {
      container.innerHTML = "";
      emptyEl.classList.remove("hidden");
      return;
    }
    emptyEl.classList.add("hidden");

    const byLevel = {};
    items.forEach((item) => {
      (byLevel[item.level] = byLevel[item.level] || []).push(item);
    });

    container.innerHTML = MAYBE_LEVEL_ORDER.filter((level) => byLevel[level] && byLevel[level].length)
      .map((level) => {
        const rows = byLevel[level].map((item) => `<li>${escapeHtml(item.name)}</li>`).join("");
        return `
          <div>
            <p class="maybe-group-title">${MAYBE_LEVEL_LABELS[level]} (${byLevel[level].length})</p>
            <ul class="name-list">${rows}</ul>
          </div>
        `;
      })
      .join("");
  }

  function fillList(listId, emptyId, items, renderItem) {
    const listEl = document.getElementById(listId);
    const emptyEl = document.getElementById(emptyId);
    listEl.innerHTML = items.map(renderItem).join("");
    emptyEl.classList.toggle("hidden", items.length > 0);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(`panel-${btn.dataset.tab}`).classList.remove("hidden");
    });
  });

  // ---- Boot ----
  if (currentUser && USER_LABELS[currentUser]) {
    enterSwipeScreen();
  } else {
    showScreen("login");
  }
})();
