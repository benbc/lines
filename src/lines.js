import * as idb from "https://cdn.jsdelivr.net/npm/idb@8/+esm";

window.addEventListener("load", (_) => control());

async function control() {
  let db = await openDB();
  const script = new Script();
  const scheduler = new Scheduler(db, script.getAllLines());

  while (true) {
    await logSummary(db);

    const event = await keyPress("l", "d");
    if (event.key === "l") {
      await learn(scheduler, script);
      console.log("Done learning");
    } else if (event.key === "d") {
      await deleteDB(db);
      db = await openDB();
      scheduler.db = db;
    }
  }
}

class Scheduler {
  constructor(db, allLines) {
    this.db = db;
    this.allLines = allLines;
  }

  async findFirstUnlearnt() {
    const learntLines = await this.getLearntLines();
    for (let line of this.allLines) {
      if (!learntLines.includes(line)) {
        return line;
      }
    }
    console.log("Nothing to learn");
  }

  async getLearntLines() {
    return await this.db.getAllKeys("lines");
  }

  async storeLine(line) {
    await this.db.put("lines", { id: line });
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

async function deleteDB(db) {
  await db.close();
  await idb.deleteDB(db.name);
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
  const chunkSize = 5;
  const chunk = script.linesUpTo(line, chunkSize);
  await learnChunk(chunk, scheduler, script);
}

async function learnChunk(chunk, scheduler, script) {
  const fragments = [];
  for (let fragmentSize = 1; fragmentSize <= chunk.length; fragmentSize++) {
    fragments.push(chunk.slice(-fragmentSize));
  }
  for (let fragment of fragments) {
    await learnFragment(fragment, scheduler, script);
  }
}

async function learnFragment(fragment, scheduler, script) {
  for (const line of fragment) {
    await checkLine(line, scheduler, script);
  }
}

async function checkLine(line, scheduler, script) {
  script.makeCurrent(line);
  const remembered = await checkRemembered(script);
  if (remembered) {
    await scheduler.storeLine(line);
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

class Script {
  getAllLines() {
    const lines = Array.from(document.getElementsByTagName("P"));
    return lines.map((e) => e.id);
  }

  linesUpTo(end, count) {
    const endLine = document.getElementById(end);

    const lines = [];
    for (
      let line = endLine;
      lines.length < count && line.tagName === "P";
      line = line.previousElementSibling
    ) {
      lines.unshift(line.id);
    }

    return lines;
  }

  makeCurrent(line) {
    this.#deselectLine(this.#getCurrentLine());
    this.#selectLine(document.getElementById(line));
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

  countLinesAbove(line) {
    return this.#countLines(line, (l) => l.previousElementSibling);
  }

  countLinesBelow(line) {
    return this.#countLines(line, (l) => l.nextElementSibling);
  }

  displayCurrentLine() {
    this.#getCurrentLine().classList.add("display");
  }

  hideCurrentLine() {
    this.#getCurrentLine().classList.remove("display");
  }

  #countLines(from, dirFn) {
    const element = document.getElementById(from);
    let count = 0;
    for (let line = element; line?.tagName === "P"; line = dirFn(line)) {
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
