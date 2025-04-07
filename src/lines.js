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
      // await deleteDB(db);
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

  async hasRecordOf(line) {
    return (await this.#getCard(line)) !== undefined;
  }

  async isDueToday(line) {
    return this.#isCardDueToday(await this.#getCard(line));
  }

  async anyDueToday(lines) {
    for (let line of lines) {
      if (await this.isDueToday(line)) {
        return true;
      }
    }
    return false;
  }

  async findEarliestDueToday() {
    const earliest = await this.db.getFromIndex(
      "lines",
      "by-due",
      IDBKeyRange.lowerBound(new Date(0)),
    );
    if (this.#isCardDueToday(earliest)) return earliest.id;
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

  async anyNeedLearning(lines) {
    for (let line of lines) {
      if (await this.needsLearning(line)) {
        return true;
      }
    }
    return false;
  }

  async recordLearning(line) {
    let card = await this.#getCard(line);
    if (!card) {
      card = tsfsrs.createEmptyCard();
      card.id = line;
    }
    console.log(card);

    let learnCount;
    if ([State.New, State.Learning].includes(card.state)) {
      learnCount = card.reps;
    } else if (card.state == State.Relearning) {
      // We add our own state to record how long we've been relearning for
      if (!card.relearnReps) {
        card.relearnReps = 0;
      }
      learnCount = card.relearnReps;
      card.relearnReps += 1;
    } else {
      console.assert(false);
    }
    // This is a bit of a hack to get FSRS to give us a couple of reviews
    // on the same day, then another review the next day, then put the line
    // into the standard review flow.
    const ratings = [Rating.Again, Rating.Hard, Rating.Hard, Rating.Good];
    if (learnCount >= ratings.length) {
      learnCount = ratings.length - 1;
    }

    await this.#updateCard(card, ratings[learnCount]);
  }

  async recordReview(line, result) {
    let card = await this.#getCard(line);
    console.assert(card);
    this.#updateCard(card, result);
  }

  async logStats() {
    const lines = await this.db.getAll("lines");

    console.log(
      `${lines.length} lines (of which ${lines.filter(this.#isCardDueToday).length} due today)`,
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

  async #updateCard(card, rating) {
    const updated = this.fsrs.next(card, new Date(), rating).card;
    await this.#putCard(updated);
  }

  async #getCard(line) {
    return await this.db.get("lines", line);
  }

  async #putCard(card) {
    await this.db.put("lines", card);
  }

  #isCardDueToday(card) {
    return card && (card.due < new Date() || isToday(card.due));
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
  const earliest = await scheduler.findEarliestDueToday();
  if (!earliest) return;

  if (await scheduler.needsLearning(earliest)) {
    console.log("learning review");
    await learnLineSubsequentTimes(earliest, scheduler, script);
  } else {
    console.log("standard review");
    await reviewLine(earliest, script, scheduler);
  }
}

async function reviewLine(earliest, script, scheduler) {
  let lines = [earliest];

  while (true) {
    const linesBefore = script.linesBefore(lines[0], 5);
    if (linesBefore.length == 0) break;
    lines = linesBefore.concat(lines);
    if (!(await scheduler.anyDueToday(linesBefore))) break;
  }

  while (true) {
    const linesAfter = script.linesAfter(lines[lines.length - 1], 5);
    if (linesAfter.length == 0) break;
    if (!(await scheduler.anyDueToday(linesAfter))) break;
    lines = lines.concat(linesAfter);
  }

  const due = [];
  for (let line of lines) {
    if (await scheduler.isDueToday(line)) {
      due.push(line);
    }
  }
  console.log(`Reviewing ${lines.length} lines (${due.length} due)`);

  for (let line of lines) {
    const rating = await checkLine(line, scheduler, script);
    await scheduler.recordReview(line, rating);
  }
}

async function learnLineSubsequentTimes(target, scheduler, script) {
  let lines = [target];

  while (true) {
    const linesBefore = script.linesBefore(lines[0], 5);
    if (linesBefore.length == 0) break;
    lines = linesBefore.concat(lines);
    if (!(await scheduler.anyNeedLearning(linesBefore))) break;
  }

  while (true) {
    const linesAfter = script.linesAfter(lines[lines.length - 1], 5);

    while (
      linesAfter.length > 0 &&
      !(await scheduler.hasRecordOf(linesAfter[linesAfter.length - 1]))
    ) {
      linesAfter.pop();
    }
    if (linesAfter.length == 0) break;
    if (!(await scheduler.anyNeedLearning(linesAfter))) break;

    lines = lines.concat(linesAfter);
  }

  const ratings = new Map();
  for (let slice of allSlices(lines, 5)) {
    let line;
    let rating;
    for (line of slice) {
      rating = await checkLine(line, scheduler, script);
      ratings.set(line, rating);
    }
  }

  // We only rate each line once, otherwise the short-term repetition makes
  // the FSRS algorithm think the lines are easier than they really are.
  for (let line of lines) {
    await scheduler.recordReview(line, ratings.get(line));
  }
}

function* allSlices(arr, len) {
  const numSlices = len - 1 + arr.length;
  for (let i = 0; i < numSlices; i++) {
    let start = i - (len - 1);
    let clippedStart = Math.max(start, 0);
    let end = start + (len - 1);
    let clippedEnd = Math.min(arr.length - 1, end);
    yield arr.slice(clippedStart, clippedEnd + 1);
  }
}

async function learn(scheduler, script) {
  const line = await scheduler.findFirstUnlearnt();
  if (!line) return;
  await learnLineFirstTime(line, scheduler, script);
}

async function learnLineFirstTime(line, scheduler, script) {
  for (const fragment of chunk(line, script)) {
    for (const line of fragment) {
      await checkLine(line, scheduler, script);
    }
  }
  await scheduler.recordLearning(line);
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
chunk.size = 4;

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
    elem.classList.add("show-all");
  }

  hide(line) {
    const elem = document.getElementById(line);
    elem.classList.remove("show-all");
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

function isToday(date) {
  return (
    new Date().toISOString().slice(0, 10) == date.toISOString().slice(0, 10)
  );
}
