import * as idb from "https://cdn.jsdelivr.net/npm/idb@8/+esm";
import * as tsfsrs from "https://cdn.jsdelivr.net/npm/ts-fsrs@latest/+esm";

const Rating = tsfsrs.Rating;
const State = tsfsrs.State;

window.addEventListener("load", (_) => control());

async function control() {
  let db = await openDB();
  const script = new Script();
  const scheduler = new Scheduler(db, script.getAllLines());
  await scheduler.pruneOrphanedLines();

  while (true) {
    await scheduler.logStats();

    const event = await keyPress("l", "r", "d", "e");
    if (event.key === "l") {
      await learn(scheduler, script);
      console.log("Done learning");
    } else if (event.key === "r") {
      await review(scheduler, script);
      console.log("Done reviewing");
    } else if (event.key === "d") {
      await deleteDB(db);
      db = await openDB();
      scheduler.db = db;
      console.log("Deleted database");
    } else if (event.key === "e") {
      console.log("experimenting");
    }
  }
}

class Scheduler {
  constructor(db, allLines) {
    this.db = db;
    this.allLines = allLines;
    this.fsrs = tsfsrs.fsrs();
  }

  async pruneOrphanedLines() {
    for (var line of await this.#getLearntLines()) {
      if (!this.allLines.includes(line)) {
        // this line has been removed from the script
        await this.db.delete("lines", line);
        console.log(`pruned ${line}`);
      }
    }
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

  async needsLearning(line) {
    const card = await this.#getCard(line);
    return [State.Learning, State.Relearning].includes(card.state);
  }

  async recordResult(line, result) {
    let card = await this.#getCard(line);
    if (!card) {
      card = tsfsrs.createEmptyCard();
      card.id = line;
    }
    card = this.fsrs.next(card, new Date(), result).card;
    await this.db.put("lines", card);
  }

  async logStats() {
    const lines = await this.db.getAll("lines");

    console.log(
      `${lines.length} lines (of which ${lines.filter(this.#isCardDue).length} due)`,
    );

    const states = objMap(
      partition(lines, (l) => State[l.state]),
      (ls) => ls.length,
    );
    console.log("States:");
    console.log(states);

    const difficulties = objMap(
      partition(lines, (l) => Math.trunc(l.difficulty)),
      (ls) => ls.length,
    );
    console.log("Difficulties:");
    console.log(difficulties);
    console.log(
      `Average ${average(lines.map((l) => l.difficulty)).toPrecision(2)}`,
    );

    const dueDates = objSort(
      objMap(
        partition(lines, (l) => l.due.toISOString().slice(0, 10)),
        (ls) => ls.length,
      ),
    );
    console.log("Due dates:");
    console.log(dueDates);
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

async function review(scheduler, script) {
  const earliest = await scheduler.findEarliestDue();
  if (!earliest) return;

  if (await scheduler.needsLearning(earliest)) {
    await learnLine(earliest, scheduler, script);
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
    const rating = await checkLine(line, scheduler, script);
    await scheduler.recordResult(line, rating);
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
      // We always rate newly-learnt lines as Hard because our learning algorithm shows
      // them to us repeatedly. If we record all those quick views as Good or Easy,
      // FSRS will think the line is very easy and won't show it to us again for ages.
      await scheduler.recordResult(line, Rating.Hard);
    }
  }
}

async function checkLine(line, scheduler, script) {
  script.highlight(line);
  const rating = await getRating(line, script);
  script.unhighlight(line);
  return rating;
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

function partition(arr, fun) {
  const result = {};
  for (let x of arr) {
    const v = fun(x);
    if (!Object.hasOwn(result, v)) {
      result[v] = [];
    }
    result[v].push(x);
  }
  return result;
}

function objMap(obj, fun) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fun(v)]));
}

function objSort(obj) {
  return Object.fromEntries(Object.entries(obj).sort());
}

function average(nums) {
  return nums.reduce((acc, val) => acc + val, 0) / nums.length;
}
