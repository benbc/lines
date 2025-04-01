import * as idb from "https://cdn.jsdelivr.net/npm/idb@8/+esm";
import * as tsfsrs from "https://cdn.jsdelivr.net/npm/ts-fsrs@latest/+esm";

const Rating = tsfsrs.Rating;
const State = tsfsrs.State;

window.addEventListener("load", (_) => control());

async function control() {
  let db = await openDB();
  const script = new Script();
  const scheduler = new Scheduler(db, script.getAllLines());

  while (true) {
    await scheduler.logSummary();

    const event = await keyPress("l", "r", "i", "d");
    if (event.key === "l") {
      await learn(scheduler, script);
      console.log("Done learning");
    } else if (event.key === "r") {
      await review(scheduler, script);
      console.log("Done reviewing");
    } else if (event.key === "i") {
      await ingest(scheduler, script);
      console.log("Done ingesting");
    } else if (event.key === "d") {
      await deleteDB(db);
      db = await openDB();
      scheduler.db = db;
      console.log("Deleted database");
    }
  }
}

class Scheduler {
  constructor(db, allLines) {
    this.db = db;
    this.allLines = allLines;
    this.fsrs = tsfsrs.fsrs();
  }

  async isDue(line) {
    return this.#isCardDue(await this.#getCard(line));
  }

  async anyDue(lines) {
    for (let line of lines) {
      if (await this.isDue(line)) {
        return true;
      }
    }
    return false;
  }

  async findEarliestDue() {
    const earliest = await this.db.getFromIndex(
      "lines",
      "by-due",
      IDBKeyRange.lowerBound(new Date(0)),
    );
    if (this.#isCardDue(earliest)) return earliest.id;
  }

  async findFirstUnlearnt() {
    const learntLines = await this.#getLearntLines();
    for (let line of this.allLines) {
      if (!learntLines.includes(line)) {
        return line;
      }
    }
    console.log("Nothing to learn");
  }

  async needsRelearning(line) {
    const card = await this.#getCard(line);
    return card.state == State.Relearning;
  }

  async recordResult(line, result) {
    let card = await this.#getCard(line);
    if (!card) {
      card = tsfsrs.createEmptyCard(new Date());
      card.id = line;
    }
    card = this.fsrs.next(card, new Date(), result).card;
    await this.db.put("lines", card);
  }

  async logSummary() {
    const lines = await this.db.getAll("lines");

    console.log(
      `${lines.length} lines (of which ${lines.filter(this.#isCardDue).length} due)`,
    );

    const states = new Map();
    for (let line of lines) {
      let state = State[line.state]; // convert to readable strings
      if (!states.has(state)) states.set(state, 0);
      states.set(state, states.get(state) + 1);
    }
    console.log("States:");
    console.log(states);

    let difficulties = new Map();
    for (let line of lines) {
      let difficulty = Math.trunc(line.difficulty);
      if (!difficulties.has(difficulty)) difficulties.set(difficulty, 0);
      difficulties.set(difficulty, difficulties.get(difficulty) + 1);
    }
    difficulties = new Map([...difficulties.entries()].sort());
    console.log("Difficulties:");
    console.log(difficulties);
  }

  async #getCard(line) {
    return await this.db.get("lines", line);
  }

  #isCardDue(card) {
    return card && card.due < new Date();
  }

  async #getLearntLines() {
    return await this.db.getAllKeys("lines");
  }
}

async function openDB() {
  return await idb.openDB("lines", 1, {
    upgrade(db, oldVersion, newVersion) {
      console.log(`Upgrading db "lines" from ${oldVersion} to ${newVersion}`);
      if (oldVersion < 1) {
        const store = db.createObjectStore("lines", { keyPath: "id" });
        store.createIndex("by-due", "due");
      }
    },
  });
}

async function deleteDB(db) {
  await db.close();
  await idb.deleteDB(db.name);
}

async function ingest(scheduler, script) {
  for (let i = 0; i < 20; i++) {
    const line = await scheduler.findFirstUnlearnt();
    if (!line) return;
    await checkLine(line, scheduler, script);
  }
}

async function review(scheduler, script) {
  const earliest = await scheduler.findEarliestDue();
  if (!earliest) return;

  if (await scheduler.needsRelearning(earliest)) {
    console.log("relearning");
    await learnLine(earliest);
  } else {
    await reviewLine(earliest, script, scheduler);
  }
}

async function reviewLine(earliest, script, scheduler) {
  let lines = [earliest];

  while (true) {
    const linesBefore = script.linesBefore(lines[0], 5);
    if (linesBefore.length == 0) break;
    lines = linesBefore.concat(lines);
    if (!(await scheduler.anyDue(linesBefore))) break;
  }

  while (true) {
    const linesAfter = script.linesAfter(lines[lines.length - 1], 5);
    if (linesAfter.length == 0) break;
    if (!(await scheduler.anyDue(linesAfter))) break;
    lines = lines.concat(linesAfter);
  }

  for (let line of lines) {
    await checkLine(line, scheduler, script);
  }
}

async function learn(scheduler, script) {
  const line = await scheduler.findFirstUnlearnt();
  if (!line) return;
  await learnLine(line, scheduler, script);
}

async function learnLine(line, scheduler, script) {
  for (const fragment of chunk(line, script)) {
    for (const line of fragment) {
      await checkLine(line, scheduler, script);
    }
  }
}

async function checkLine(line, scheduler, script) {
  script.highlight(line);
  const rating = await getRating(line, script);
  await scheduler.recordResult(line, rating);
  script.unhighlight(line);
}

async function getRating(line, script) {
  const keyMap = {
    "`": Rating.Again,
    1: Rating.Hard,
    2: Rating.Good,
    3: Rating.Easy,
  };
  var key = (await keyPress(...Object.keys(keyMap), " ")).key;
  if (key === " ") {
    script.show(line);
    key = (await keyPress(...Object.keys(keyMap))).key;
    script.hide(line);
  }
  return keyMap[key];
}

function* chunk(line, script) {
  const lines = script.linesBefore(line, chunk.size).concat(line);
  for (let i = 1; i <= lines.length; i++) {
    yield lines.slice(-i);
  }
}
chunk.size = 5;

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

  linesBefore(end, count) {
    const endLine = document.getElementById(end);

    const lines = [];
    for (
      let line = endLine.previousElementSibling;
      lines.length < count && line.tagName === "P";
      line = line.previousElementSibling
    ) {
      lines.unshift(line.id);
    }

    return lines;
  }

  linesAfter(start, count) {
    const startLine = document.getElementById(start);

    const lines = [];
    for (
      let line = startLine.nextElementSibling;
      lines.length < count && line.tagName === "P";
      line = line.nextElementSibling
    ) {
      lines.push(line.id);
    }

    return lines;
  }

  highlight(line) {
    const elem = document.getElementById(line);
    elem.classList.add("current-line");
    elem.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  unhighlight(line) {
    const elem = document.getElementById(line);
    elem.classList.remove("current-line");
  }

  show(line) {
    const elem = document.getElementById(line);
    elem.classList.add("display");
  }

  hide(line) {
    const elem = document.getElementById(line);
    elem.classList.remove("display");
  }
}
