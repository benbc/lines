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

  async getDifficulty(line) {
    return (await this.#getCard(line)).difficulty;
  }

  async findFirstReview() {
    const earliest = await this.db.getFromIndex(
      "lines",
      "by-due",
      IDBKeyRange.lowerBound(new Date(0)),
    );
    if (earliest) return earliest.id;
  }

  async isReviewable(line) {
    return (await this.#getReviewable()).includes(line);
  }

  async anyReviewable(lines) {
    const reviewable = await this.#getReviewable();
    return lines.some((l) => reviewable.includes(l));
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

  async recordReview(line, result) {
    let card = await this.#getCard(line);
    if (!card) {
      card = tsfsrs.createEmptyCard();
      card.id = line;
    }
    this.#updateCard(card, result);
  }

  async logStats() {
    const lines = await this.db.getAll("lines");

    console.log(`${lines.length} lines`);

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

  async #getLearntLines() {
    return await this.db.getAllKeys("lines");
  }

  async #getReviewable() {
    const all = await this.db.getAllKeysFromIndex(
      "lines",
      "by-due",
      IDBKeyRange.lowerBound(new Date(0)),
    );
    return all.slice(0, 50);
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
  const line = await scheduler.findFirstReview();
  if (!line) return;
  await reviewLine(line, script, scheduler);
}

async function reviewLine(target, script, scheduler) {
  let lines = [target];

  // Prepend lines until we see three consecutive unreviewable lines
  let line = target;
  while (true) {
    line = script.lineBefore(line);
    if (!line) break;
    lines.unshift(line);
    if (!(await scheduler.anyReviewable(lines.slice(0, 3)))) break;
  }

  // Detach the unreviewable prefix
  const prefix = [];
  while (!(await scheduler.isReviewable(lines[0]))) {
    prefix.push(lines.shift());
  }

  // Append lines until we see three consecutive unreviewable lines or an unlearnt one
  line = target;
  while (true) {
    line = script.lineAfter(line);
    if (!line) break;
    if (!(await scheduler.hasRecordOf(line))) break;
    lines.push(line);
    if (!(await scheduler.anyReviewable(lines.slice(lines.length - 3)))) break;
  }

  // Discard the unreviewable suffix
  while (!(await scheduler.isReviewable(lines[lines.length - 1]))) {
    lines.pop();
  }

  script.showWordInitials(prefix);

  for (let line of lines) {
    switch (await scheduler.getDifficulty(line)) {
      case 1:
        script.showNone(line);
        break;
      case 2:
        script.showLineInitials(line);
        break;
      default:
        script.showWordInitials(line);
    }
  }

  for (let line of lines) {
    const rating = await checkLine(line, scheduler, script);
    await scheduler.recordReview(line, rating);
    script.showWordInitials(line);
  }

  script.showNone(prefix);
  script.showNone(lines);
}

async function learn(scheduler, script) {
  const line = await scheduler.findFirstUnlearnt();
  if (!line) return;
  await learnLine(line, scheduler, script);
}

async function learnLine(target, scheduler, script) {
  const before = script.linesBefore(target, 2);
  const after = [];
  for (const line of script.linesAfter(target, 9)) {
    if (await scheduler.hasRecordOf(line)) break;
    after.push(line);
  }

  const toLearn = [target].concat(after);
  const all = before.concat(toLearn);

  script.showWordInitials(all);

  for (const slice of allSlices(toLearn, 5)) {
    for (const line of slice) {
      await checkLine(line, scheduler, script);
      script.showWordInitials(line);
    }
  }

  // Only record each line onece. Otherwise all the repetition and the ease with
  // which these lines are recalled in the short term causes FSRS to think that
  // all newly learnt lines are easy.
  for (const line of toLearn) {
    await scheduler.recordReview(line, Rating.Hard);
  }

  script.showNone(all);
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
  const keys = [...Object.keys(keyMap), " "];

  let key;
  while ((key = (await keyPress(...keys)).key) === " ") {
    script.increaseVisibility(line);
  }
  console.assert(Object.hasOwn(keyMap, key));

  return keyMap[key];
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

  lineBefore(line) {
    const elem = document.getElementById(line);
    const prev = elem.previousElementSibling;
    if (prev && prev.tagName === "P") return prev.id;
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

  lineAfter(line) {
    const elem = document.getElementById(line);
    const next = elem.nextElementSibling;
    if (next && next.tagName === "P") return next.id;
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

  increaseVisibility(line) {
    const elem = document.getElementById(line);

    // Find the singular current visibility class
    const visClasses = Array.from(elem.classList).filter((c) =>
      Script.visibilityClasses.includes(c),
    );
    console.assert(visClasses.length == 1);
    const oldVis = visClasses[0];

    // Calculate the increased visibility
    const index = Script.visibilityClasses.indexOf(oldVis);
    if (index === Script.visibilityClasses.length - 1) return;
    const newVis = Script.visibilityClasses[index + 1];

    this.#setVisibility([line], newVis);
  }

  showNone(...lines) {
    this.#setVisibility(lines, "show-none");
  }

  showLineInitials(...lines) {
    this.#setVisibility(lines, "show-line-initials");
  }

  showWordInitials(...lines) {
    this.#setVisibility(lines, "show-word-initials");
  }

  showAll(...lines) {
    this.#setVisibility(lines, "show-all");
  }

  #setVisibility(lines, visibility) {
    for (let line of lines.flat()) {
      const elem = document.getElementById(line);
      elem.classList.remove(...Script.visibilityClasses);
      elem.classList.add(visibility);
    }
  }
}
Script.visibilityClasses = [
  "show-none",
  "show-line-initials",
  "show-word-initials",
  "show-all",
];

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
