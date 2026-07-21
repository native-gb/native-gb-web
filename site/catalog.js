const list = document.querySelector("#game-list");
const detail = document.querySelector("#game-detail");
const rowTemplate = document.querySelector("#game-row-template");

let games = [];
let selectedId = "";

function gameFromHash() {
  return decodeURIComponent(location.hash.replace(/^#/, ""));
}

function featureList(features) {
  const list = document.createElement("ul");
  list.className = "feature-list";
  for (const feature of features) {
    const item = document.createElement("li");
    item.textContent = feature;
    list.append(item);
  }
  return list;
}

function renderDetail(game) {
  detail.replaceChildren();

  const media = document.createElement("div");
  media.className = "game-detail__media";
  const image = document.createElement("img");
  image.src = game.image;
  image.alt = `Abstract Game Boy palette artwork for ${game.title}`;
  image.decoding = "async";
  media.append(image);

  const body = document.createElement("div");
  body.className = "game-detail__body";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = `${game.system} / ${game.revision}`;
  const title = document.createElement("h2");
  title.textContent = game.title;
  const description = document.createElement("p");
  description.className = "description";
  description.textContent = game.description;
  const status = document.createElement("div");
  status.className = `runtime-status${game.browser.ready ? " runtime-status--ready" : ""}`;
  status.innerHTML = `<i aria-hidden="true"></i><span>${game.browser.status}</span>`;

  const actions = document.createElement("div");
  actions.className = "actions";
  const play = document.createElement("a");
  play.className = "button button--primary";
  play.href = game.play_url;
  play.textContent = game.browser.ready ? "PLAY IN BROWSER" : "OPEN BROWSER LAUNCHER";
  const source = document.createElement("a");
  source.className = "button";
  source.href = game.source_url;
  source.rel = "noopener noreferrer";
  source.textContent = "VIEW SOURCE ↗";
  actions.append(play, source);

  body.append(eyebrow, title, description, featureList(game.features), status, actions);
  detail.append(media, body);
}

function selectGame(id, updateAddress = true) {
  const game = games.find((candidate) => candidate.id === id) || games[0];
  if (!game)
    return;
  selectedId = game.id;
  for (const row of list.querySelectorAll(".game-row"))
    row.setAttribute("aria-selected", String(row.dataset.gameId === selectedId));
  renderDetail(game);
  if (updateAddress)
    history.replaceState(null, "", `#${encodeURIComponent(game.id)}`);
}

function renderList() {
  list.replaceChildren();
  games.forEach((game, index) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.gameId = game.id;
    row.querySelector(".game-row__number").textContent = String(index + 1).padStart(2, "0");
    row.querySelector("strong").textContent = game.title;
    row.querySelector("small").textContent = game.browser.status;
    row.addEventListener("click", () => selectGame(game.id));
    list.append(row);
  });
}

async function loadCatalog() {
  try {
    const response = await fetch("catalog.json");
    if (!response.ok)
      throw new Error(`catalog request returned ${response.status}`);
    const catalog = await response.json();
    games = catalog.games;
    renderList();
    selectGame(gameFromHash(), false);
  } catch (error) {
    detail.innerHTML = `<div class="loading-panel loading-panel--error">CATALOG ERROR<br><small>${error.message}</small></div>`;
  }
}

window.addEventListener("hashchange", () => selectGame(gameFromHash(), false));
loadCatalog();
