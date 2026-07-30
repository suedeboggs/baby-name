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
    progressFill: document.getElementById("progress-fill"),
    progressLabel: document.getElementById("progress-label"),
    cardEmpty: document.getElementById("card-empty"),
    card: document.getElementById("card"),
    cardCategory: document.getElementById("card-category"),
    cardName: document.getElementById("card-name"),
    cardPronunciation: document.getElementById("card-pronunciation"),
    cardAltSpellings: document.getElementById("card-alt-spellings"),
    stampLike: document.querySelector(".stamp-like"),
    stampNope: document.querySelector(".stamp-nope"),
    btnLike: document.getElementById("btn-like"),
    btnDislike: document.getElementById("btn-dislike"),
    btnUndo: document.getElementById("btn-undo"),
    btnResults: document.getElementById("btn-results"),
    btnSeeResults: document.getElementById("btn-see-results"),
    btnSwitchUser: document.getElementById("btn-switch-user"),
    btnBackToSwipe: document.getElementById("btn-back-to-swipe"),
  };

  let currentUser = localStorage.getItem("babyNamesUser") || null;
  let state = null; // last /api/state response
  let dragging = false;
  let dragStartX = 0;
  let dragCurrentX = 0;
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

  function fetchState(user) {
    return api(`/api/state?user=${encodeURIComponent(user)}`);
  }

  function postVote(user, name, liked) {
    return api("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, name, liked }),
    });
  }

  function postUndo(user) {
    return api("/api/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user }),
    });
  }

  function resetCardTransform() {
    els.card.style.transition = "none";
    els.card.style.transform = "translate(0, 0) rotate(0deg)";
    els.stampLike.style.opacity = 0;
    els.stampNope.style.opacity = 0;
  }

  function renderState(s) {
    state = s;
    els.progressFill.style.width = s.total
      ? `${(s.votedCount / s.total) * 100}%`
      : "0%";
    els.progressLabel.textContent = `${s.votedCount} / ${s.total} reviewed`;
    els.btnUndo.disabled = !s.canUndo;
    els.btnUndo.style.opacity = s.canUndo ? 1 : 0.35;

    if (!s.card) {
      els.card.classList.add("hidden");
      els.cardEmpty.classList.remove("hidden");
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
    const s = await fetchState(currentUser);
    renderState(s);
  }

  async function vote(liked) {
    if (!state || !state.card) return;
    const name = state.card;
    animateCardAway(liked, async () => {
      const s = await postVote(currentUser, name, liked);
      renderState(s);
    });
  }

  function animateCardAway(liked, onDone) {
    const dir = liked ? 1 : -1;
    els.card.style.transition = "transform 0.35s ease";
    els.card.style.transform = `translate(${dir * 600}px, -40px) rotate(${dir * 30}deg)`;
    setTimeout(onDone, 220);
  }

  async function undo() {
    if (!state || !state.canUndo) return;
    const s = await postUndo(currentUser);
    renderState(s);
  }

  // ---- Drag handling ----
  function onPointerDown(e) {
    if (!state || !state.card) return;
    dragging = true;
    pointerId = e.pointerId;
    els.card.setPointerCapture(pointerId);
    dragStartX = e.clientX;
    dragCurrentX = e.clientX;
    els.card.style.transition = "none";
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    dragCurrentX = e.clientX;
    const dx = dragCurrentX - dragStartX;
    const rotate = dx / 12;
    els.card.style.transform = `translate(${dx}px, 0) rotate(${rotate}deg)`;
    const likeOpacity = Math.max(0, Math.min(1, dx / 100));
    const nopeOpacity = Math.max(0, Math.min(1, -dx / 100));
    els.stampLike.style.opacity = likeOpacity;
    els.stampNope.style.opacity = nopeOpacity;
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    if (pointerId !== null) {
      els.card.releasePointerCapture(pointerId);
      pointerId = null;
    }
    const dx = dragCurrentX - dragStartX;
    const THRESHOLD = 100;
    if (dx > THRESHOLD) {
      vote(true);
    } else if (dx < -THRESHOLD) {
      vote(false);
    } else {
      els.card.style.transition = "transform 0.25s ease";
      resetCardTransform();
    }
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
    if (e.key === "ArrowRight") vote(true);
    if (e.key === "ArrowLeft") vote(false);
  });

  els.btnLike.addEventListener("click", () => vote(true));
  els.btnDislike.addEventListener("click", () => vote(false));
  els.btnUndo.addEventListener("click", undo);

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
    showScreen("swipe");
    await loadState();
  }

  els.btnSwitchUser.addEventListener("click", () => {
    currentUser = null;
    localStorage.removeItem("babyNamesUser");
    showScreen("login");
  });

  // ---- Results ----
  els.btnResults.addEventListener("click", showResults);
  els.btnSeeResults.addEventListener("click", showResults);
  els.btnBackToSwipe.addEventListener("click", async () => {
    showScreen("swipe");
    await loadState();
  });

  async function showResults() {
    showScreen("results");
    const data = await api("/api/results");
    renderResults(data);
  }

  function renderResults(data) {
    document.getElementById("count-matches").textContent = data.matches.length;
    document.getElementById("count-onesided").textContent = data.oneSided.length;
    document.getElementById("count-disliked").textContent = data.bothDisliked.length;
    document.getElementById("count-pending").textContent = data.pending.length;

    fillList("list-matches", "empty-matches", data.matches, (name) => `<li>${escapeHtml(name)}</li>`);

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
