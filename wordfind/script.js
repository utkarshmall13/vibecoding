"use strict";

const GRID_SIZE = 20;
const MAX_WORDS = 15;

let gridLetters = [];
let placedWords = [];
let currentSelection = [];
let isDragging = false;
let dragStartCell = null;
let foundCount = 0;

// DOM refs
let gridEl, wordsListEl, foundCountEl, totalCountEl, statusEl, themeInputEl;

// Directions (8 possible straight lines)
const DIRECTIONS = [
  { dx: 0, dy: 1 },   // right
//   { dx: 0, dy: -1 },  // left
  { dx: 1, dy: 0 },   // down
//   { dx: -1, dy: 0 },  // up
  { dx: 1, dy: 1 },   // diag down-right
//   { dx: -1, dy: -1 }, // diag up-left
//   { dx: 1, dy: -1 },  // diag down-left
//   { dx: -1, dy: 1 }   // diag up-right
];

document.addEventListener("DOMContentLoaded", () => {
  gridEl = document.getElementById("grid");
  wordsListEl = document.getElementById("words-list");
  foundCountEl = document.getElementById("found-count");
  totalCountEl = document.getElementById("total-count");
  statusEl = document.getElementById("status");
  themeInputEl = document.getElementById("theme-input");

  setupGridEvents();

  document
    .getElementById("generate-btn")
    .addEventListener("click", () => {
      const rawTheme = themeInputEl.value.trim();
      const theme = rawTheme || "animals"; // default if empty
      generatePuzzle(theme);
    });

  // Initial puzzle
  generatePuzzle("animal");
});

/* -------------------- Confetti helpers -------------------- */

function fireConfettiSmall() {
  if (typeof confetti !== "function") return;

  const originX = 0.3 + Math.random() * 0.4; // somewhere near center
  confetti({
    particleCount: 60,
    spread: 70,
    startVelocity: 40,
    gravity: 0.9,
    ticks: 200,
    origin: { x: originX, y: 0.3 }
  });
}

function fireConfettiBig() {
  if (typeof confetti !== "function") return;

  // Two bursts from left & right
  confetti({
    particleCount: 180,
    spread: 120,
    startVelocity: 50,
    scalar: 1.1,
    origin: { x: 0.2, y: 0.4 }
  });

  confetti({
    particleCount: 180,
    spread: 120,
    startVelocity: 50,
    scalar: 1.1,
    origin: { x: 0.8, y: 0.4 }
  });

  // Gentle shower from the top
  setTimeout(() => {
    confetti({
      particleCount: 120,
      spread: 80,
      startVelocity: 30,
      gravity: 1,
      origin: { x: 0.5, y: 0 }
    });
  }, 350);
}

/* -------------------- API + puzzle build -------------------- */

async function fetchWords(theme) {
  const base = "https://api.datamuse.com/words";
  let data = [];
  // 0) Try a method to get hyponyms via wordnik api
  // (Optional) You could add a Wordnik API call here for richr hyponym data.
  // Example (requires API key):
  const YOUR_API_KEY = "YOUR_WORDNIK"
  const wordnikUrl = `https://api.wordnik.com/v4/word.json/${encodeURIComponent(theme)}/relatedWords?useCanonical=false&relationshipTypes=hyponym&limitPerRelationshipType=100&api_key=${YOUR_API_KEY}`;
  try {
    const res = await fetch(wordnikUrl);
    if (res.ok) {
      const wordnikData = await res.json();
      // Parse and add to data if needed
      if (Array.isArray(wordnikData)) {
        for (const rel of wordnikData) {
          if (rel.relationshipType === "hyponym" && Array.isArray(rel.words)) {
            for (const w of rel.words) {
              // Wordnik words are plain strings, add as objects for consistency
              data.push({ word: w, tags: ["n"], score: 0 });
            }
          }
        }
      }
    }
    console.log("Wordnik hyponym data:", data);
  } catch (e) {
    console.error("Wordnik fetch failed", e);
  }

  // 1) Try to get "examples of <theme>" (hyponyms)
  const urlHyponyms =
    `${base}?rel_gen=${encodeURIComponent(theme)}&max=80&md=fp`;

  try {
    const res = await fetch(urlHyponyms);
    if (res.ok) {
      data = await res.json();
      console.log("Hyponym data:", data);
    }
  } catch (e) {
    console.error("Hyponym fetch failed", e);
  }

  // 1.5 Use rel_spc
  if (!data || data.length < 8) {
    const urlRelSpc =
      `${base}?rel_spc=${encodeURIComponent(theme)}&max=80&md=fp`;
      
    try {
      const res = await fetch(urlRelSpc);
      if (res.ok) {
        const data2 = await res.json();
        console.log("rel_spc data:", data2);
        // concat data and data2, avoiding duplicates
        const seenWords = new Set(data.map(item => item.word));
        for (const item of data2) {
          if (!seenWords.has(item.word)) {
            data.push(item);
          }
        }
      }
    }
    catch (e) {
      console.error("rel_spc fetch failed", e);
    }
  }


  // 2) If we didn’t get enough, fall back to a softer "names of <theme>" query
  if (!data || data.length < 8) {
    const fallbackQuery = `a type of ${theme}`;
    const urlFallback =
      `${base}?ml=${encodeURIComponent(fallbackQuery)}&max=80&md=fp`;

    try {
      const res2 = await fetch(urlFallback);
      if (res2.ok) {
        const data2 = await res2.json();
        console.log("Fallback data:", data2);
        // concat data and data2, avoiding duplicates
        const seenWords = new Set(data.map(item => item.word));
        for (const item of data2) {
          if (!seenWords.has(item.word)) {
            data.push(item);
          }
        }
      }
    } catch (e) {
      console.error("Fallback fetch failed", e);
    }
  }

  // Sort by decreasing frequency (highest first)
  data = data.sort((a, b) => {
    const fa = (a.tags && a.tags.find(t => t.startsWith("f:"))) ? parseFloat(a.tags.find(t => t.startsWith("f:")).slice(2)) : 0;
    const fb = (b.tags && b.tags.find(t => t.startsWith("f:"))) ? parseFloat(b.tags.find(t => t.startsWith("f:")).slice(2)) : 0;
    const va = a.score || 0;
    const vb = b.score || 0;
    const la = (a.word && a.word.length) ? a.word.length : 0;
    const lb = (b.word && b.word.length) ? b.word.length : 0;

    return fb*lb - fa*la;
    // return vb-va;
  });

  // Only include common nouns (tag "n"), exclude pronouns and similar (tag "pron")
  data = data.filter(item =>
    item.tags &&
    item.tags.includes("n") &&
    !item.tags.includes("pron")&&
    !item.tags.includes("adj")
  );
  console.log("Filtered noun-prioritized data:", data);


  // Filter: alphabetic only, reasonable length, no spaces, uppercase.
  // Optionally bias to nouns if tags are present.
  const words = [];
  const seen = new Set();

  for (const item of data) {
    const w = String(item.word).toUpperCase();
    if (!/^[A-Z]+$/.test(w)) continue;
    if (w.length < 3 || w.length > 12) continue;

    // If Datamuse tags are present, prefer nouns
    if (item.tags && !item.tags.includes("n")) continue;

    if (seen.has(w)) continue;
    seen.add(w);
    words.push(w);
    if (words.length >= MAX_WORDS * 2) break; // grab a bit extra
  }

  // Take up to MAX_WORDS, preferring longer words first
  words.sort((a, b) => b.length - a.length);
  return words.slice(0, Math.max(MAX_WORDS, 10));
}

async function generatePuzzle(theme) {
  setStatus(`Making a puzzle about "${theme}"…`);
  foundCount = 0;
  updateCounter(0, 0);
  gridLetters = [];
  placedWords = [];
  clearGridDom();
  clearWordsList();

  try {
    const words = await fetchWords(theme);
    if (words.length < 5) {
      setStatus(
        `Could only find ${words.length} words for "${theme}". Try a simpler theme like "animals" or "space".`
      );
      return;
    }
    buildPuzzleFromWords(words);
    setStatus(`Find all the words related to "${theme}".`);
  } catch (err) {
    console.error(err);
    setStatus("Error talking to the word API. Please try again.");
  }
}

function buildPuzzleFromWords(words) {
  // Init empty grid
  gridLetters = Array.from({ length: GRID_SIZE }, () =>
    Array(GRID_SIZE).fill(null)
  );
  placedWords = [];
  foundCount = 0;

  // Sort words by length (desc) and try to place up to MAX_WORDS
  const toPlace = words.slice().sort((a, b) => b.length - a.length);
  for (const word of toPlace) {
    if (placedWords.length >= MAX_WORDS) break;
    placeSingleWord(word);
  }

  if (placedWords.length === 0) {
    setStatus("Could not place any words on the grid. Try again.");
    return;
  }

  // Fill remaining cells with random letters
  fillRandomLetters();

  // Render grid + word list
  renderGrid();
  renderWordsList();
  updateCounter(0, placedWords.length);
}

/* -------------------- Word placement -------------------- */

function placeSingleWord(word) {
  const len = word.length;
  const maxAttempts = 250;
  let attempt = 0;
  const hasExistingLetters = placedWords.length > 0;

  while (attempt < maxAttempts) {
    attempt++;

    const dir =
      DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    const { dx, dy } = dir;

    const rowRange = getStartRange(GRID_SIZE, len, dx);
    const colRange = getStartRange(GRID_SIZE, len, dy);

    const startRow =
      rowRange.min +
      Math.floor(Math.random() * (rowRange.max - rowRange.min + 1));
    const startCol =
      colRange.min +
      Math.floor(Math.random() * (colRange.max - colRange.min + 1));

    let overlaps = 0;
    let conflict = false;
    const positions = [];

    for (let i = 0; i < len; i++) {
      const r = startRow + dx * i;
      const c = startCol + dy * i;
      const existing = gridLetters[r][c];
      const letter = word[i];

      if (existing && existing !== letter) {
        conflict = true;
        break;
      }
      if (existing === letter) overlaps++;
      positions.push({ r, c });
    }

    if (conflict) continue;

    // Encourage intersections: if there are existing letters,
    // prefer placements that intersect them (overlaps > 0).
    if (hasExistingLetters && overlaps === 0 && attempt < maxAttempts * 0.7) {
      continue;
    }

    // Place the word
    for (let i = 0; i < len; i++) {
      const pos = positions[i];
      gridLetters[pos.r][pos.c] = word[i];
    }

    placedWords.push({
      word,
      positions,
      dx,
      dy,
      found: false
    });

    return;
  }
  // If we get here, we failed to place the word; just skip it.
}

function getStartRange(size, len, d) {
  if (d === 0) {
    return { min: 0, max: size - 1 };
  }
  if (d > 0) {
    return { min: 0, max: size - len };
  }
  // d < 0
  return { min: len - 1, max: size - 1 };
}

function fillRandomLetters() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!gridLetters[r][c]) {
        const ch = alphabet[Math.floor(Math.random() * alphabet.length)];
        gridLetters[r][c] = ch;
      }
    }
  }
}

/* -------------------- Rendering -------------------- */

function renderGrid() {
  clearGridDom();
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.textContent = gridLetters[r][c] || "";
      gridEl.appendChild(cell);
    }
  }
}

function clearGridDom() {
  if (gridEl) gridEl.innerHTML = "";
}

function renderWordsList() {
  clearWordsList();
  for (const w of placedWords) {
    const li = document.createElement("li");
    li.textContent = w.word;
    li.dataset.word = w.word;
    wordsListEl.appendChild(li);
  }
  updateCounter(foundCount, placedWords.length);
}

function clearWordsList() {
  if (wordsListEl) wordsListEl.innerHTML = "";
}

function updateCounter(found, total) {
  if (foundCountEl) foundCountEl.textContent = String(found);
  if (totalCountEl) totalCountEl.textContent = String(total);
}

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

/* -------------------- Grid interaction (drag selection) -------------------- */

function setupGridEvents() {
  // Mouse events for now (desktop-friendly)
  gridEl.addEventListener("mousedown", (e) => {
    const cell = getCellFromEvent(e);
    if (!cell) return;
    e.preventDefault();
    startDrag(cell);
  });

  gridEl.addEventListener("mouseover", (e) => {
    if (!isDragging) return;
    const cell = getCellFromEvent(e);
    if (!cell) return;
    updateSelection(cell);
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      endDrag();
    }
  });
  gridEl.addEventListener("touchstart", onTouchStart, { passive: false });
  gridEl.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd);
  document.addEventListener("touchcancel", onTouchEnd);

}

function getCellFromEvent(e) {
  const target = e.target;
  if (!target || !target.classList) return null;
  if (!target.classList.contains("cell")) return null;
  return target;
}

function getCellFromTouch(e) {
  const touch = e.touches[0] || e.changedTouches[0];
  if (!touch) return null;

  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  if (!el || !el.classList || !el.classList.contains("cell")) {
    return null;
  }
  return el;
}

function startDrag(cell) {
  isDragging = true;
  dragStartCell = cell;
  clearSelectionPreview();
  currentSelection = [cell];
  cell.classList.add("selected-preview");
}

function onMouseDown(e) {
  const cell = getCellFromEvent(e);
  if (!cell) return;
  e.preventDefault();
  startDrag(cell);
}

function onMouseOver(e) {
  if (!isDragging) return;
  const cell = getCellFromEvent(e);
  if (!cell) return;
  e.preventDefault();
  updateSelection(cell);
}

function onMouseUp(e) {
  if (!isDragging) return;
  e.preventDefault();
  endDrag();
}

function onTouchStart(e) {
  const cell = getCellFromTouch(e);
  if (!cell) return;
  e.preventDefault(); // stop page from scrolling / text selection
  startDrag(cell);
}

function onTouchMove(e) {
  if (!isDragging) return;
  const cell = getCellFromTouch(e);
  if (!cell) return;
  e.preventDefault();
  updateSelection(cell);
}

function onTouchEnd(e) {
  if (!isDragging) return;
  // no need to locate a cell here, just finish the drag
  endDrag();
}


function updateSelection(cell) {
  if (!dragStartCell) return;

  const startRow = parseInt(dragStartCell.dataset.row, 10);
  const startCol = parseInt(dragStartCell.dataset.col, 10);
  const endRow = parseInt(cell.dataset.row, 10);
  const endCol = parseInt(cell.dataset.col, 10);

  const dRow = endRow - startRow;
  const dCol = endCol - startCol;

  if (dRow === 0 && dCol === 0) {
    clearSelectionPreview();
    currentSelection = [dragStartCell];
    dragStartCell.classList.add("selected-preview");
    return;
  }

  const stepRow = Math.sign(dRow);
  const stepCol = Math.sign(dCol);

  // Must be straight line: horizontal, vertical, or true diagonal
  if (!(dRow === 0 || dCol === 0 || Math.abs(dRow) === Math.abs(dCol))) {
    return;
  }

  const length = Math.max(Math.abs(dRow), Math.abs(dCol)) + 1;
  const newSelection = [];

  for (let i = 0; i < length; i++) {
    const r = startRow + stepRow * i;
    const c = startCol + stepCol * i;
    const selector = `.cell[data-row="${r}"][data-col="${c}"]`;
    const cellEl = gridEl.querySelector(selector);
    if (!cellEl) return; // invalid path
    newSelection.push(cellEl);
  }

  clearSelectionPreview();
  currentSelection = newSelection;
  for (const el of currentSelection) {
    el.classList.add("selected-preview");
  }
}

function endDrag() {
  isDragging = false;
  if (!currentSelection || currentSelection.length < 3) {
    clearSelectionPreview();
    currentSelection = [];
    dragStartCell = null;
    return;
  }

  const coords = currentSelection.map((cell) => ({
    r: parseInt(cell.dataset.row, 10),
    c: parseInt(cell.dataset.col, 10)
  }));
  const letters = currentSelection.map((cell) => cell.textContent).join("");

  checkSelection(letters, coords);
  dragStartCell = null;
}

/* -------------------- Matching logic -------------------- */

function checkSelection(letters, coords) {
  const forward = letters.toUpperCase();
  const backward = forward.split("").reverse().join("");

  // Try to match a placed word exactly (same path or reversed path)
  let matchedIndex = -1;

  placedWords.forEach((w, idx) => {
    if (matchedIndex !== -1) return;
    if (w.found) return;

    if (w.word === forward || w.word === backward) {
      if (pathsMatch(w.positions, coords) || pathsMatchReversed(w.positions, coords)) {
        matchedIndex = idx;
      }
    }
  });

  if (matchedIndex === -1) {
    markSelectionWrong();
  } else {
    markSelectionCorrect(matchedIndex);
  }
}

function pathsMatch(positions, coords) {
  if (positions.length !== coords.length) return false;
  for (let i = 0; i < positions.length; i++) {
    if (positions[i].r !== coords[i].r || positions[i].c !== coords[i].c) {
      return false;
    }
  }
  return true;
}

function pathsMatchReversed(positions, coords) {
  if (positions.length !== coords.length) return false;
  const n = positions.length;
  for (let i = 0; i < n; i++) {
    const p = positions[n - 1 - i];
    const c = coords[i];
    if (p.r !== c.r || p.c !== c.c) {
      return false;
    }
  }
  return true;
}

function markSelectionCorrect(wordIndex) {
  const entry = placedWords[wordIndex];
  entry.found = true;
  foundCount++;
  updateCounter(foundCount, placedWords.length);

  for (const cell of currentSelection) {
    cell.classList.remove("wrong", "selected-preview");
    cell.classList.add("found");
  }

  // Mark in word list
  const lis = wordsListEl.querySelectorAll("li");
  for (const li of lis) {
    if (li.dataset.word === entry.word) {
      li.classList.add("found");
    }
  }

  // 🎉 Confetti!
  fireConfettiSmall();

  if (foundCount === placedWords.length) {
    setStatus("🎉 You found ALL the words! Amazing job!");
    fireConfettiBig();
  }

  currentSelection = [];
}

function markSelectionWrong() {
  for (const cell of currentSelection) {
    if (!cell.classList.contains("found")) {
      cell.classList.add("wrong");
    }
  }

  const toClear = [...currentSelection];
  currentSelection = [];

  setTimeout(() => {
    for (const cell of toClear) {
      if (!cell.classList.contains("found")) {
        cell.classList.remove("wrong", "selected-preview");
      } else {
        cell.classList.remove("wrong");
      }
    }
  }, 800);
}

function clearSelectionPreview() {
  const previewCells = gridEl.querySelectorAll(".cell.selected-preview");
  previewCells.forEach((cell) => {
    if (!cell.classList.contains("found")) {
      cell.classList.remove("selected-preview");
    }
  });
}
