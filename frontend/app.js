const API_BASE = window.SONORA_API_BASE || localStorage.getItem("sonora-api-base") || window.location.origin;
const state = { current: null, queue: [], paused: false, positionMs: 0 };
const trackCache = new Map();
const $ = (id) => document.getElementById(id);
const audio = $("audioPlayer");
let playbackEnabled = false;
let playbackError = false;
let playbackLoading = false;
let playAttempt = 0;

let playerSessionPromise;
const getPlayerSession = () => playerSessionPromise ||= (async () => {
  const old=sessionStorage.getItem("sonora-player-token");
  const response=await fetch(API_BASE+"/api/player/session",{method:"POST",headers:old?{Authorization:"Bearer "+old}:{}});
  const body=await response.json();if(!response.ok)throw new Error(body.error || "Player session unavailable");
  sessionStorage.setItem("sonora-player-token",body.token);return body;
})().catch(error=>{playerSessionPromise=null;throw error;});
const api = async (path, options = {}) => {
  const session=path.startsWith("/api/player/")?await getPlayerSession():null;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(session ? {Authorization:"Bearer "+session.token} : {}), ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
};
const formatTime = (ms) => {
  const seconds = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
let toastTimer;
const toast = (message) => {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").classList.add("show");
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 6000);
};
function streamUrl(id) { return `${API_BASE}/api/stream/${encodeURIComponent(id)}`; }
function renderPlayback() {
  const playing = Boolean(state.current && !audio.paused && !playbackError);
  $("livePill").textContent = !state.current ? "IDLE" : playbackError ? "UNAVAILABLE" : playbackLoading ? "LOADING" : playing ? "PLAYING" : "PAUSED";
  $("playPause").textContent = playing || playbackLoading ? "Ⅱ" : "▶";
  $("playPause").dataset.action = playing || playbackLoading ? "pause" : "resume";
  $("playPause").title = playing || playbackLoading ? "Pause" : playbackError ? "Retry playback" : "Play";
}
async function playLocal(track, retry = false) {
  if (!track) return;
  const changed = audio.dataset.trackId !== track.id;
  if (!changed && !retry && (playbackError || playbackLoading || !audio.paused)) return;
  const attempt = ++playAttempt;
  playbackError = false;
  playbackLoading = true;
  if (changed || retry || audio.error) {
    audio.dataset.trackId = track.id;
    audio.src = streamUrl(track.id);
    audio.load();
  }
  renderPlayback();
  try {
    await audio.play();
  } catch (error) {
    if (attempt !== playAttempt) return;
    if (error.name !== "AbortError") {
      playbackError = true;
      toast(error.name === "NotAllowedError"
        ? "Press play to allow audio in this browser."
        : "Audio is unavailable. Press play to retry, or try another track.");
    }
  } finally {
    if (attempt === playAttempt) {
      playbackLoading = false;
      renderPlayback();
    }
  }
}
function syncAudio() {
  if (!state.current) {
    ++playAttempt;
    playbackLoading = false;
    playbackError = false;
    audio.pause();
    audio.removeAttribute("src");
    delete audio.dataset.trackId;
    audio.load();
  } else if (state.paused) {
    ++playAttempt;
    playbackLoading = false;
    audio.pause();
  } else if (playbackEnabled) {
    void playLocal(state.current);
  }
  renderPlayback();
}
function renderState(snapshot) {
  Object.assign(state, snapshot);
  const track = state.current;
  if (track) trackCache.set(track.id, track);
  $("currentTitle").textContent = track?.title || "Nothing queued";
  $("currentAuthor").textContent = track?.author || "Search for something to play";
  const localPosition = audio.dataset.trackId === track?.id ? audio.currentTime * 1000 : 0;
  $("elapsed").textContent = formatTime(localPosition);
  $("duration").textContent = formatTime(track?.durationMs);
  $("progress").max = track?.durationMs || 100;
  $("progress").value = Math.min(localPosition, Number($("progress").max));
  const artwork = $("currentArtwork");
  if (track?.thumbnail) artwork.src = track.thumbnail;
  else artwork.removeAttribute("src");
  artwork.classList.toggle("visible", Boolean(track?.thumbnail));
  $("artFallback").style.display = track?.thumbnail ? "none" : "grid";
  $("queueCount").textContent = `${state.queue.length} track${state.queue.length === 1 ? "" : "s"}`;
  $("queueList").innerHTML = state.queue.length ? state.queue.map((item, index) => {
    trackCache.set(item.id, item);
    return `<div class="track-row"><span class="index">${String(index + 1).padStart(2, "0")}</span><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.author)}</p></div><button data-remove="${index}" title="Remove">×</button></div>`;
  }).join("") : `<div class="empty-state">Queue is clear.</div>`;
  syncAudio();
}
function escapeHtml(value = "") {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function renderResults(tracks) {
  tracks.forEach((track) => trackCache.set(track.id, track));
  $("resultCount").textContent = `${tracks.length} found`;
  $("resultsList").innerHTML = tracks.length ? tracks.map((track) => `<div class="track-row"><img src="${escapeHtml(track.thumbnail || "")}" alt="" /><div><h3>${escapeHtml(track.title)}</h3><p>${escapeHtml(track.author)} · ${formatTime(track.durationMs)}</p></div><button data-play="${encodeURIComponent(track.id)}">Play</button></div>`).join("") : `<div class="empty-state">No playable results found.</div>`;
}
async function control(action, body) {
  try {
    renderState(await api(`/api/player/${action}`, { method: "POST", body: JSON.stringify(body || {}) }));
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}
$("searchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = $("searchInput").value.trim();
  if (!query) return;
  $("searchStatus").textContent = "Searching…";
  try {
    renderResults(await api(`/api/search?q=${encodeURIComponent(query)}&type=video`));
    $("searchStatus").textContent = "Select a track to start listening.";
  } catch (error) { $("searchStatus").textContent = error.message; }
});
document.addEventListener("click", async (event) => {
  const play = event.target.closest("[data-play]");
  if (play) {
    const track = trackCache.get(decodeURIComponent(play.dataset.play));
    if (!track) return;
    playbackEnabled = true;
    if (state.current?.id === track.id) {
      void playLocal(track, playbackError || Boolean(audio.error));
      await control("resume");
    } else {
      // The backend enqueues results. Only play its current track so the
      // artwork, queue and browser audio cannot disagree.
      await control("play", { videoId: track.id });
    }
    return;
  }
  const remove = event.target.closest("[data-remove]");
  if (remove) {
    api(`/api/player/queue/${remove.dataset.remove}`, { method: "DELETE" }).then(renderState).catch((error) => toast(error.message));
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "resume") {
    playbackEnabled = true;
    void playLocal(state.current, playbackError || Boolean(audio.error));
  } else if (action === "pause" || action === "stop") {
    ++playAttempt;
    playbackLoading = false;
    audio.pause();
    renderPlayback();
  }
  await control(action);
});
$("volume").addEventListener("input", (event) => {
  $("volumeValue").textContent = event.target.value;
  audio.volume = Number(event.target.value) / 100;
});
$("volume").addEventListener("change", (event) => control("volume", { volume: Number(event.target.value) }));
$("progress").addEventListener("change", (event) => {
  if (!audio.readyState) return;
  audio.currentTime = Number(event.target.value) / 1000;
  void control("seek", { position: Number(event.target.value) });
});
audio.addEventListener("timeupdate", () => {
  $("elapsed").textContent = formatTime(audio.currentTime * 1000);
  $("progress").value = audio.currentTime * 1000;
});
audio.addEventListener("playing", () => {
  playbackError = false;
  playbackLoading = false;
  renderPlayback();
});
audio.addEventListener("waiting", () => {
  if (!audio.paused) playbackLoading = true;
  renderPlayback();
});
audio.addEventListener("pause", renderPlayback);
audio.addEventListener("error", () => {
  if (!audio.getAttribute("src") || !audio.error) return;
  playbackError = true;
  playbackLoading = false;
  renderPlayback();
  toast("Audio is unavailable. Press play to retry, or try another track.");
});
audio.addEventListener("ended", () => { void control("skip"); });
audio.volume = 0.8;
async function connectEvents() {
  const abort=new AbortController();
  window.addEventListener("pagehide",()=>abort.abort(),{once:true});
  while(!abort.signal.aborted){
    try{
      const session=await getPlayerSession();
      const response=await fetch(API_BASE+"/api/events",{headers:{Authorization:"Bearer "+session.token},signal:abort.signal,cache:"no-store"});
      if(response.status===401)playerSessionPromise=null;
      if(!response.ok || !response.body)throw new Error("Event stream unavailable");
      $("connectionDot").classList.remove("offline");$("connectionLabel").textContent="Live connection";
      const reader=response.body.getReader(),decoder=new TextDecoder();let pending="";
      try{while(!abort.signal.aborted){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true}).replace(/\r\n/g,"\n");let at;
        while((at=pending.indexOf("\n\n"))>=0){const lines=pending.slice(0,at).split("\n");pending=pending.slice(at+2);const name=lines.find(l=>l.startsWith("event:"))?.slice(6).trim();const json=lines.filter(l=>l.startsWith("data:")).map(l=>l.slice(5).trimStart()).join("\n");
          if(!["queue","trackStart","trackEnd"].includes(name) || !json)continue;
          const data=JSON.parse(json);if((data.playerId || data.guildId)!==session.playerId)continue;
          if(name==="queue")renderState(data);else api("/api/player/state").then(renderState).catch(()=>{});
        }
      }}finally{await reader.cancel().catch(()=>{});}
    }catch{if(abort.signal.aborted)return;}
    $("connectionDot").classList.add("offline");$("connectionLabel").textContent="Reconnecting";
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
}

api("/api/player/state").then(renderState).catch(() => {
  $("connectionDot").classList.add("offline");
  $("connectionLabel").textContent = "Backend offline";
});
connectEvents();
