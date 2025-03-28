import * as idb from "https://cdn.jsdelivr.net/npm/idb@8/+esm";

window.addEventListener("load", (_) => control());

async function control() {
  const db = await openDB();
  await logSummary(db);
  const scheduler = new Scheduler(db, getAllIds());
  const navigator = new Navigator();

  while (true) {
    await keyPress("l");
    await learn(scheduler, navigator);
  }
}

class Scheduler {
  constructor(db, allIds) {
    this.db = db;
    this.allIds = allIds;
  }

  async findFirstUnlearnt() {
    const learntIds = await this.getLearntIds();
    for (let id of this.allIds) {
      if (!learntIds.includes(id)) {
        return id;
      }
    }
    console.log("Nothing to learn");
  }

  async getLearntIds() {
    return await this.db.getAllKeys("lines");
  }

  async storeId(id) {
    await this.db.put("lines", { id: id });
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

async function learn(scheduler, navigator) {
  const line = await scheduler.findFirstUnlearnt();
  if (!line) return;
  flagLearning();
  await learnLine(line, scheduler, navigator);
  unflagLearning();
}

async function learnLine(line, scheduler, navigator) {
  navigator.makeCurrent(line);

  const fullChunkSize = 5;
  const maxLinesAbove = Math.min(fullChunkSize - 1, countLinesAbove());
  const maxLinesBelow = Math.min(fullChunkSize - 1, countLinesBelow());

  for (let linesAbove = maxLinesAbove; linesAbove >= 0; linesAbove--) {
    let linesBelow = Math.min(fullChunkSize - 1 - linesAbove, maxLinesBelow);
    let chunkSize = linesAbove + 1 + linesBelow;
    await learnChunk(chunkSize, scheduler, navigator);
    navigator.moveForward(1);
  }
}

async function learnChunk(chunkSize, scheduler, navigator) {
  for (let fragmentSize = 1; fragmentSize <= chunkSize; fragmentSize++) {
    navigator.moveBack(fragmentSize - 1);
    await learnFragment(fragmentSize, scheduler, navigator);
  }
}

async function learnFragment(size, scheduler, navigator) {
  for (let i = 0; i < size; i++) {
    await checkLine(scheduler, navigator);
    navigator.moveForward(1);
  }
  navigator.moveBack(1);
}

async function checkLine(scheduler, navigator) {
  const remembered = await checkRemembered();
  if (remembered) {
    const id = navigator.getCurrent();
    await scheduler.storeId(id);
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

function getAllIds() {
  const lines = Array.from(document.getElementsByTagName("P"));
  return lines.map((e) => e.id);
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

class Navigator {
  makeCurrent(line) {
    const element = document.getElementById(line);
    console.assert(line);
    const current = getCurrentLine();
    deselectLine(current);
    selectLine(element);
  }

  moveForward(lines) {
    for (let i = 0; i < lines; i++) {
      selectNextLine();
    }
  }

  moveBack(lines) {
    for (let i = 0; i < lines; i++) {
      selectPreviousLine();
    }
  }

  getCurrent() {
    return getCurrentLine().id;
  }
}
