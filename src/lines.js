import * as idb from "https://cdn.jsdelivr.net/npm/idb@8/+esm";

window.addEventListener("load", (_) => control());

async function control() {
  const db = await openDB();
  await logSummary(db);
  const scheduler = new Scheduler(db, getAllIds());
  const script = new Script();

  while (true) {
    await keyPress("l");
    await learn(scheduler, script);
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

async function learn(scheduler, script) {
  const line = await scheduler.findFirstUnlearnt();
  if (!line) return;
  await learnLine(line, scheduler, script);
}

async function learnLine(line, scheduler, script) {
  script.makeCurrent(line);

  const fullChunkSize = 5;
  const maxLinesAbove = Math.min(fullChunkSize - 1, script.countLinesAbove());
  const maxLinesBelow = Math.min(fullChunkSize - 1, script.countLinesBelow());

  for (let linesAbove = maxLinesAbove; linesAbove >= 0; linesAbove--) {
    let linesBelow = Math.min(fullChunkSize - 1 - linesAbove, maxLinesBelow);
    let chunkSize = linesAbove + 1 + linesBelow;
    await learnChunk(chunkSize, scheduler, script);
    script.moveForward(1);
  }
}

async function learnChunk(chunkSize, scheduler, script) {
  for (let fragmentSize = 1; fragmentSize <= chunkSize; fragmentSize++) {
    script.moveBack(fragmentSize - 1);
    await learnFragment(fragmentSize, scheduler, script);
  }
}

async function learnFragment(size, scheduler, script) {
  for (let i = 0; i < size; i++) {
    await checkLine(scheduler, script);
    script.moveForward(1);
  }
  script.moveBack(1);
}

async function checkLine(scheduler, script) {
  const remembered = await checkRemembered(script);
  if (remembered) {
    const id = script.getCurrent();
    await scheduler.storeId(id);
  }
}

async function checkRemembered(script) {
  var key = (await keyPress(".", ",", "m")).key;
  if (key === "m") {
    script.displayCurrentLine();
    key = (await keyPress(".", ",")).key;
    script.hideCurrentLine();
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

function getAllIds() {
  const lines = Array.from(document.getElementsByTagName("P"));
  return lines.map((e) => e.id);
}

class Script {
  makeCurrent(line) {
    const element = document.getElementById(line);
    console.assert(line);
    const current = this.#getCurrentLine();
    this.#deselectLine(current);
    this.#selectLine(element);
  }

  moveForward(lines) {
    for (let i = 0; i < lines; i++) {
      this.#selectNextLine();
    }
  }

  moveBack(lines) {
    for (let i = 0; i < lines; i++) {
      this.#selectPreviousLine();
    }
  }

  getCurrent() {
    return this.#getCurrentLine().id;
  }

  countLinesAbove() {
    return this.#countLines((line) => line.previousElementSibling);
  }

  countLinesBelow() {
    return this.#countLines((line) => line.nextElementSibling);
  }

  displayCurrentLine() {
    this.#getCurrentLine().classList.add("display");
  }

  hideCurrentLine() {
    this.#getCurrentLine().classList.remove("display");
  }

  #countLines(dirFn) {
    let count = 0;
    for (
      let line = this.#getCurrentLine();
      line?.tagName === "P";
      line = dirFn(line)
    ) {
      count++;
    }
    return count - 1; // exclude current element
  }

  #selectNextLine() {
    this.#moveSelected((line) => line.nextElementSibling);
  }

  #selectPreviousLine() {
    this.#moveSelected((line) => line.previousElementSibling);
  }

  #moveSelected(dirFn) {
    const currentLine = this.#getCurrentLine();
    const siblingLine = dirFn(currentLine);
    if (!siblingLine || siblingLine.tagName !== "P") return;
    this.#deselectLine(currentLine);
    this.#selectLine(siblingLine);
  }

  #deselectLine(line) {
    line.classList.remove("current-line");
  }

  #selectLine(line) {
    line.classList.add("current-line");
    line.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  #getCurrentLine() {
    return document.querySelector("p.current-line");
  }
}
