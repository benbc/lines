import * as idb from "https://cdn.jsdelivr.net/npm/idb@8/+esm";

const Result = {
  Good: 3,
  Okay: 2,
  Fail: 1,
};
const Display = {
  WordInitials: 0,
  LineInitials: 1,
  None: 2,
};

function clampDisplay(display) {
  return clamp(display, 0, 2);
}

function clampEase(ease) {
  return clamp(ease, 0, 8);
}

window.addEventListener("load", (_) => control());

async function control() {
  let db = await openDB();
  const script = new Script();
  const scheduler = new Scheduler(db, script.getAllLines());
  await scheduler.pruneOrphanedLines();

  while (true) {
    await scheduler.logStats();

    const event = await keyPress("l", "r", "i", "d", "e");
    if (event.key === "l") {
      await learn(scheduler, script);
    } else if (event.key === "r") {
      await review(scheduler, script);
    } else if (event.key === "i") {
      await ingest(scheduler, script);
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

  async getDisplay(line) {
    return (await this.#getCard(line)).display;
  }

  async findFirstReviewable() {
    return (await this.#getReviewable())[0];
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
  }

  async addNew(line, defaults) {
    console.assert(!(await this.hasRecordOf(line)));
    const card = Object.assign({ id: line }, defaults);
    recordDates(card);
    this.#putCard(card);
  }

  async recordReview(line, result) {
    const oldCard = await this.#getCard(line);
    console.assert(oldCard);
    const newCard = { id: line };

    switch (result) {
      case Result.Good:
        recordSuccess(oldCard, newCard, 2);
        break;
      case Result.Okay:
        recordSuccess(oldCard, newCard, 1);
        break;
      case Result.Fail:
        recordFailure(oldCard, newCard);
        break;
      default:
        console.error(`impossible result ${result}`);
    }

    recordDates(newCard);

    this.#putCard(newCard);
  }

  async logStats() {
    const lines = await this.db.getAll("lines");

    console.log(`${lines.length} lines`);

    const due = objSort(
      objMap(
        partition(lines, (l) => l.due),
        (ls) => ls.length,
      ),
    );
    console.log("Due:");
    console.log(due);

    const ease = objMap(
      partition(lines, (l) => l.ease),
      (ls) => ls.length,
    );
    console.log("Ease:");
    console.log(ease);

    const display = objMap(
      partition(lines, (l) => l.display),
      (ls) => ls.length,
    );
    console.log("Display:");
    console.log(display);

    const streak = objMap(
      partition(lines, (l) => l.streak),
      (ls) => ls.length,
    );
    console.log("Streak:");
    console.log(streak);
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
    const all = await this.db.getAllFromIndex(
      "lines",
      "by-due",
      IDBKeyRange.upperBound(dateOnly(new Date())),
    );
    all.sort((fst, snd) => fst.lastReview - snd.lastReview);
    return all.map((l) => l.id);
  }
}

function recordSuccess(oldCard, newCard, easeDelta) {
  if (isToday(oldCard.lastReview) && !isToday(oldCard.due)) {
    // Don't consider lines to be getting easier if we repeatedly review them
    // on the same day
    newCard.ease = oldCard.ease;
    newCard.streak = oldCard.streak;
    newCard.display = oldCard.display;
    return;
  }

  newCard.ease = clampEase(oldCard.ease + easeDelta);
  newCard.streak = oldCard.streak + 1;

  if (newCard.streak === 3) {
    newCard.display = clampDisplay(oldCard.display + 1);
    newCard.streak = 0;
  } else {
    newCard.display = oldCard.display;
  }
}

function recordFailure(oldCard, newCard) {
  newCard.ease = clampEase(oldCard.ease - 3);
  newCard.streak = 0;
  newCard.display = Display.WordInitials;
}

function recordDates(card) {
  card.due = dateOnly(addDays(fuzzEase(card.ease), new Date()));
  card.lastReview = new Date();
}

function fuzzEase(ease) {
  const fuzzedEase = Math.round(normalRandom(ease, ease / 4));
  return clamp(fuzzedEase, 0, 14);
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
  const line = await scheduler.findFirstUnlearnt();
  if (!line) return;
  await ingestFromLine(line, scheduler, script);
}

async function ingestFromLine(target, scheduler, script) {
  // Assemble a prefix of up to three known lines
  const prefixLength = 3;
  const prefix = [];
  let line = target;
  while (true) {
    line = script.lineBefore(line);
    if (!line) break;
    console.assert(await scheduler.hasRecordOf(line));
    prefix.unshift(line);
    if (prefix.length === prefixLength) break;
  }

  // Assemble up to 20 lines to ingest
  const lines = [target];
  while (true) {
    line = script.lineAfter(lines[lines.length - 1]);
    if (!line) break;
    console.assert(!(await scheduler.hasRecordOf(line)));
    lines.push(line);
    if (lines.length >= 20) break;
  }

  script.showWordInitials(prefix);
  if (prefix.length === prefixLength) {
    script.showAll(prefix[0]);
  }
  script.showWordInitials(lines);

  for (let line of lines) {
    const rating = await checkLine(line, script);
    let ease, streak;
    switch (rating) {
      case Result.Good:
        ease = 3;
        streak = 2;
        break;
      case Result.Okay:
        ease = 2;
        streak = 1;
        break;
      case Result.Fail:
        ease = streak = 0;
        break;
      default:
        console.error(`impossible rating ${rating}`);
    }
    await scheduler.addNew(line, {
      ease: ease,
      display: Display.WordInitials,
      streak: streak,
    });
    script.showWordInitials(line);
  }

  script.showNone(prefix);
  script.showNone(lines);
}

async function review(scheduler, script) {
  const line = await scheduler.findFirstReviewable();
  if (!line) return;
  await reviewLine(line, script, scheduler);
}

async function reviewLine(target, script, scheduler) {
  let lines = [target];

  // Prepend lines until we see three consecutive unreviewable lines
  const prefixLength = 3;
  let line = target;
  while (true) {
    line = script.lineBefore(line);
    if (!line) break;
    lines.unshift(line);
    if (!(await scheduler.anyReviewable(lines.slice(0, prefixLength)))) break;
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
    if (lines.length >= 3) {
      if (!(await scheduler.anyReviewable(lines.slice(lines.length - 3))))
        break;
    }
  }

  // Discard the unreviewable suffix
  while (!(await scheduler.isReviewable(lines[lines.length - 1]))) {
    lines.pop();
  }

  script.showWordInitials(prefix);
  if (prefix.length === prefixLength) {
    script.showAll(prefix[0]);
  }

  for (let line of lines) {
    const display = await scheduler.getDisplay(line);
    switch (display) {
      case Display.None:
        script.showNone(line);
        break;
      case Display.LineInitials:
        script.showLineInitials(line);
        break;
      case Display.WordInitials:
        script.showWordInitials(line);
        break;
      default:
        console.error(`Impossible display: '${display}'`);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rating = await checkLine(line, script);
    script.showWordInitials(line);

    if (rating === Result.Fail) {
      await relearn(line, script);
    }

    await scheduler.recordReview(line, rating);
  }

  script.showNone(prefix);
  script.showNone(lines);
}

async function relearn(target, script) {
  const lines = [target];
  while (lines.length < 5) {
    const contextLine = script.lineBefore(lines[0]);
    if (!contextLine) break;
    lines.unshift(contextLine);
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    for (const line of lines.slice(i, lines.length)) {
      await checkLine(line, script);
      script.showWordInitials(line);
    }
  }
}

async function learn(scheduler, script) {
  const line = await scheduler.findFirstUnlearnt();
  if (!line) return;
  await learnFromLine(line, scheduler, script);
}

async function learnFromLine(target, scheduler, script) {
  const prefixLength = 3;
  const before = script.linesBefore(target, prefixLength);
  const after = [];
  for (const line of script.linesAfter(target, 9)) {
    if (await scheduler.hasRecordOf(line)) break;
    after.push(line);
  }

  const toLearn = [target].concat(after);
  const all = before.concat(toLearn);

  script.showWordInitials(all);
  if (before.length === prefixLength) {
    script.showAll(all[0]);
  }

  for (const slice of allSlices(toLearn, 5)) {
    for (const line of slice) {
      await checkLine(line, script);
      script.showWordInitials(line);
    }
  }

  for (const line of toLearn) {
    await scheduler.addNew(line, {
      ease: 0,
      streak: 0,
      display: Display.WordInitials,
    });
  }

  script.showNone(all);
}

async function checkLine(line, script) {
  script.highlight(line);
  const rating = await getRating(line, script);
  script.unhighlight(line);
  return rating;
}

async function getRating(line, script) {
  const keyMap = {
    1: Result.Fail,
    2: Result.Okay,
    3: Result.Good,
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

function addDays(days, date) {
  const newDate = new Date(date);
  newDate.setDate(date.getDate() + days);
  return newDate;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function isToday(date) {
  if (typeof date !== "string") {
    date = dateOnly(date);
  }
  return date === dateOnly(new Date());
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(val, max));
}

function normalRandom(mean, stdDev) {
  // Box-Muller transform for normal distribution
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}
