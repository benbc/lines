import * as idb from "https://cdn.jsdelivr.net/npm/idb@8/+esm";

window.addEventListener("load", (_) => control());

async function control() {
  const db = await openDB();
  await logSummary(db);

  while (true) {
    const event = await keyPress("ArrowLeft", "ArrowRight", "ArrowDown", "l");
    switch (event.key) {
      case "ArrowLeft":
        if (event.ctrlKey) previousScene();
        else selectPreviousLine();
        break;
      case "ArrowRight":
        if (event.ctrlKey) nextScene();
        else selectNextLine();
        break;
      case "ArrowDown":
        toggleLineDisplay();
        break;
      case "l":
        learn(db);
        break;
    }
  }
}

async function openDB() {
  return await idb.openDB("lines", 1, {
    upgrade(db, oldVersion, newVersion) {
      console.log(`Upgrading db "lines" from ${oldVersion} to ${newVersion}`);
      if (oldVersion < 1) {
        db.createObjectStore("lines", { keyPath: "id" });
      }
    },
  });
}

async function logSummary(db) {
  const lines = await db.getAll("lines");
  console.log(`database holds ${lines.length} lines`);
}

async function storeId(id, db) {
  await db.put("lines", { id: id });
}

async function getLearntIds(db) {
  return await db.getAllKeys("lines");
}

async function learn(db) {
  const id = await findFirstUnlearnt(db);
  if (!id) return;
  flagLearning();
  await learnLine(id, db);
  unflagLearning();
}

async function findFirstUnlearnt(db) {
  const learntIds = await getLearntIds(db);
  for (let id of getAllIds()) {
    if (!learntIds.includes(id)) {
      return id;
    }
  }
}

async function learnLine(id, db) {
  const line = findById(id);
  makeCurrent(line);

  const fullChunkSize = 5;
  const maxLinesAbove = Math.min(fullChunkSize - 1, countLinesAbove());
  const maxLinesBelow = Math.min(fullChunkSize - 1, countLinesBelow());

  for (let linesAbove = maxLinesAbove; linesAbove >= 0; linesAbove--) {
    let linesBelow = Math.min(fullChunkSize - 1 - linesAbove, maxLinesBelow);
    let chunkSize = linesAbove + 1 + linesBelow;
    await learnChunk(chunkSize, db);
    moveForward(1);
  }
}

async function learnChunk(chunkSize, db) {
  for (let fragmentSize = 1; fragmentSize <= chunkSize; fragmentSize++) {
    moveBack(fragmentSize - 1);
    await learnFragment(fragmentSize, db);
  }
}

async function learnFragment(size, db) {
  for (let i = 0; i < size; i++) {
    await checkLine(db);
    moveForward(1);
  }
  moveBack(1);
}

async function checkLine(db) {
  const remembered = await checkRemembered();
  if (remembered) {
    const id = getCurrentId();
    await storeId(id, db);
  }
}

async function checkRemembered() {
  var key = (await keyPress(".", ",", "m")).key;
  if (key === "m") {
    displayCurrentLine();
    key = (await keyPress(".", ",")).key;
    hideCurrentLine();
  }
  return key === ".";
}

function moveForward(lines) {
  for (let i = 0; i < lines; i++) {
    selectNextLine();
  }
}

function moveBack(lines) {
  for (let i = 0; i < lines; i++) {
    selectPreviousLine();
  }
}

async function keyPress(...expected) {
  return new Promise((resolve) => {
    const handleKeyPress = (event) => {
      if (!expected.includes(event.key)) return;
      event.preventDefault();
      document.removeEventListener("keydown", handleKeyPress);
      resolve(event);
    };
    document.addEventListener("keydown", handleKeyPress);
  });
}

function nextScene() {
  return moveScene(findNext);
}

function previousScene() {
  return moveScene(findPrevious);
}

function moveScene(dir) {
  const currentLine = getCurrentLine();
  const currentHeading = findPrevious(currentLine, "H1");

  const heading = dir(currentHeading, "H1");
  if (!heading) return;

  const firstLine = findNext(heading, "P");
  deselectLine(currentLine);
  selectLine(firstLine);
}

function findNext(from, tag) {
  return findElement(from, tag, (element) => element.nextElementSibling);
}

function findPrevious(from, tag) {
  return findElement(from, tag, (element) => element.previousElementSibling);
}

function findElement(from, tag, dir) {
  let next = from;
  while ((next = dir(next))) {
    if (next.tagName === tag) {
      return next;
    }
  }
}

function selectNextLine() {
  moveSelected((line) => line.nextElementSibling);
}

function selectPreviousLine() {
  moveSelected((line) => line.previousElementSibling);
}

function moveSelected(dirFn) {
  const currentLine = getCurrentLine();
  const siblingLine = dirFn(currentLine);
  if (!siblingLine || siblingLine.tagName !== "P") return;
  deselectLine(currentLine);
  selectLine(siblingLine);
}

function makeCurrent(line) {
  const current = getCurrentLine();
  deselectLine(current);
  selectLine(line);
}

function deselectLine(line) {
  line.classList.remove("current-line");
}

function selectLine(line) {
  line.classList.add("current-line");
  line.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

function toggleLineDisplay() {
  if (getCurrentLine().classList.contains("display")) {
    hideCurrentLine();
  } else {
    displayCurrentLine();
  }
}

function displayCurrentLine() {
  getCurrentLine().classList.add("display");
}

function hideCurrentLine() {
  getCurrentLine().classList.remove("display");
}

function countLinesAbove() {
  return countLines((line) => line.previousElementSibling);
}

function countLinesBelow() {
  return countLines((line) => line.nextElementSibling);
}

function countLines(dir) {
  let count = 0;
  for (let next = getCurrentLine(); next.tagName === "P"; next = dir(next)) {
    count++;
  }
  return count - 1; // count includes current element
}

function getCurrentId() {
  return getCurrentLine().id;
}

function getAllIds() {
  const lines = Array.from(document.getElementsByTagName("P"));
  return lines.map((e) => e.id);
}

function findById(id) {
  const line = document.getElementById(id);
  console.assert(line);
  return line;
}

function getCurrentLine() {
  return document.querySelector("p.current-line");
}

function flagLearning() {
  const rule = getCurrentLineRule();
  rule.style.setProperty("background-color", "linen");
}

function unflagLearning() {
  const rule = getCurrentLineRule();
  rule.style.removeProperty("background-color", "linen");
}

function getCurrentLineRule() {
  return [...document.styleSheets[0].cssRules].find(
    (r) => r.selectorText === ".current-line",
  );
}
