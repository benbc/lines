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

    const event = await keyPress("l", "r", "s", "i", "m", "d", "e");
    if (event.key === "l") {
      await learn(scheduler, script);
    } else if (event.key === "r") {
      await review(scheduler, script);
    } else if (event.key === "s") {
      await scene(scheduler, script);
    } else if (event.key === "i") {
      await ingest(scheduler, script);
    } else if (event.key === "m") {
      await mark(scheduler, script);
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
        // await this.db.delete("lines", line);
        console.log(`pruned ${line}`);
      }
    }
  }

  async hasRecordOf(line) {
    return (await this.getCard(line)) !== undefined;
  }

  async getCard(line) {
    return await this.db.get("lines", line);
  }

  async findFirstDue() {
    const due = await this.#getDue();
    if (due.length === 0) return;
    due.sort((fst, snd) => fst.lastReview - snd.lastReview);
    return due[0].id;
  }

  async isReviewable(line) {
    const card = await this.getCard(line);
    return isReviewable(card);
  }

  async anyReviewable(lines) {
    for (const line of lines) {
      if (await this.isReviewable(line)) {
        return true;
      }
    }
    return false;
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
    const oldCard = await this.getCard(line);
    console.assert(oldCard);

    if (!isUpdatable(oldCard) && result == !Result.Fail) return;

    const newCard = { id: line };

    switch (result) {
      case Result.Good:
        recordSuccess(oldCard, newCard, 2);
        break;
      case Result.Okay:
        recordSuccess(oldCard, newCard, 0);
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
    const lines = await this.#getAll();
    const numLines = lines.length;
    const totalLines = this.allLines.length;
    const prop = Math.round((100 * numLines) / totalLines);
    const due = lines.filter(isDue).length;
    const reviewed = lines.filter((c) => isToday(c.lastReview)).length;
    const todaysRepeats = lines.filter(
      (c) => isToday(c.lastReview) && c.ease == 0,
    ).length;
    console.log(
      `${numLines}/${totalLines} (${prop}%) lines (${due} due, ${reviewed} reviewed today, ${todaysRepeats} repeats)`,
    );

    const dueOn = objSort(
      objMap(
        partition(lines, (l) => l.due),
        (ls) => ls.length,
      ),
    );
    console.log("Due on:");
    console.log(dueOn);

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

  async #putCard(card) {
    await this.db.put("lines", card);
  }

  async #getLearntLines() {
    return await this.db.getAllKeys("lines");
  }

  async #getAll() {
    return await this.db.getAll("lines");
  }

  async #getDue() {
    const all = await this.#getAll();
    return all.filter(isDue);
  }
}

function recordSuccess(oldCard, newCard, easeDelta) {
  newCard.ease = clampEase(oldCard.ease + easeDelta);
  newCard.streak = oldCard.streak + 1;
  newCard.display = oldCard.display;

  if (newCard.display < Display.None) {
    if (
      newCard.streak >= 6 ||
      (newCard.streak === 5 && Math.random() <= 0.75) ||
      (newCard.streak === 4 && Math.random() <= 0.5)
    ) {
      newCard.ease = 1;
      newCard.streak = 0;
      newCard.display++;
    }
  }
}

function recordFailure(oldCard, newCard) {
  newCard.ease = 0;
  newCard.streak = 0;
  newCard.display = oldCard.display;
}

function recordDates(card) {
  card.due = daysFromToday(fuzzEase(card.ease));
  card.lastReview = now();
}

function isDue(card) {
  return card.due <= today();
}

function isSeenToday(card) {
  return isToday(card.lastReview);
}

function isUpdatable(card) {
  // Generally we are happy to do early reviews, but we don't want do do them repeatedly.
  return isDue(card) || !isSeenToday(card);
}

function isReviewable(card) {
  return isDue(card);
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
    let ease, display, streak;
    switch (rating) {
      case Result.Good:
        ease = randomInt(3, 8);
        display = Display.None;
        streak = 2;
        break;
      case Result.Okay:
        ease = randomInt(2, 5);
        display = Display.LineInitials;
        streak = 1;
        break;
      case Result.Fail:
        ease = 0;
        display = Display.WordInitials;
        streak = 0;
        break;
      default:
        console.error(`impossible rating ${rating}`);
    }
    await scheduler.addNew(line, {
      ease: ease,
      display: display,
      streak: streak,
    });
    script.showWordInitials(line);
  }

  script.showNone(prefix);
  script.showNone(lines);
}

async function mark(scheduler, script) {
  script.showWordInitials(script.getAllLines());
  for (let firstLine of script.scenes()) {
    lineLoop: for (let line = firstLine; line; line = script.lineAfter(line)) {
      script.highlight(line);
      const key = await keyPress("n", "s", "f");
      script.unhighlight(line);
      switch (key.key) {
        case "s":
          break lineLoop;
        case "f":
          scheduler.recordReview(line, Result.Fail);
        case "n":
      }
    }
  }
  script.showNone(script.getAllLines());
}

async function review(scheduler, script) {
  const line = await scheduler.findFirstDue();
  if (!line) return;
  await reviewLine(line, script, scheduler);
}

async function reviewLine(target, script, scheduler) {
  let lines = [target];

  // Prepend lines until we see `extensionLength` consecutive unreviewable lines
  const extensionLength = 3;
  let line = target;
  while (true) {
    line = script.lineBefore(line);
    if (!line) break;
    if (!(await scheduler.hasRecordOf(line))) break;
    lines.unshift(line);
    if (!(await scheduler.anyReviewable(lines.slice(0, extensionLength))))
      break;
  }

  // Detach the unreviewable prefix
  const prefix = [];
  while (!(await scheduler.isReviewable(lines[0]))) {
    prefix.push(lines.shift());
  }

  // Append lines until we see `extensionLength` consecutive unreviewable lines or an unlearnt one
  line = target;
  while (true) {
    line = script.lineAfter(line);
    if (!line) break;
    if (!(await scheduler.hasRecordOf(line))) break;
    lines.push(line);
    if (lines.length >= extensionLength) {
      if (
        !(await scheduler.anyReviewable(
          lines.slice(lines.length - extensionLength),
        ))
      )
        break;
    }
  }

  // Discard the unreviewable suffix
  while (!(await scheduler.isReviewable(lines[lines.length - 1]))) {
    lines.pop();
  }

  if (prefix.length >= 1) {
    script.showWordInitials(prefix[prefix.length - 1]);
  }
  if (prefix.length >= 2) {
    script.showAll(prefix[prefix.length - 2]);
  }

  await normaliseDisplay(lines, scheduler, script);
  await annotate(lines, scheduler, script);
  script.lowlight(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rating = await checkLine(line, script);
    script.showWordInitials(line);

    if (rating === Result.Fail) {
      await relearn(line, scheduler, script);
    }

    await scheduler.recordReview(line, rating);
  }

  script.unlowlight(lines);
  script.deannotate(lines);
  script.showNone(prefix);
  script.showNone(lines);
}

async function scene(scheduler, script) {
  const line = await scheduler.findFirstDue();
  if (!line) return;
  await reviewScene(line, script, scheduler);
}

async function reviewScene(target, script, scheduler) {
  let lines = [target];

  // Prepend lines until we reach the start of the scene
  let line = target;
  while (true) {
    line = script.lineBefore(line);
    if (!line) break;
    lines.unshift(line);
  }

  // Append lines until we reach the end of the scene
  line = target;
  while (true) {
    line = script.lineAfter(line);
    if (!line) break;
    if (!(await scheduler.hasRecordOf(line))) break;
    lines.push(line);
  }

  await normaliseDisplay(lines, scheduler, script);
  await annotate(lines, scheduler, script);
  script.lowlight(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rating = await checkLine(line, script);
    script.showWordInitials(line);

    if (rating === Result.Fail) {
      await relearn(line, scheduler, script);
    }

    await scheduler.recordReview(line, rating);
  }

  script.unlowlight(lines);
  script.deannotate(lines);
  script.showNone(lines);
}

async function relearn(target, scheduler, script) {
  const lines = [target];
  while (lines.length < 5) {
    const contextLine = script.lineBefore(lines[0]);
    if (!contextLine) break;
    lines.unshift(contextLine);
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    const slice = lines.slice(i, lines.length);
    await normaliseDisplay(slice, scheduler, script);
    for (const line of slice) {
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
    script.showAll(before[0]);
  }
  script.lowlight(toLearn);

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

  script.unlowlight(toLearn);
  script.showNone(all);
}

async function normaliseDisplay(lines, scheduler, script) {
  for (let line of lines) {
    const card = await scheduler.getCard(line);
    switch (card.display) {
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
        console.error(`Impossible display: '${card.display}'`);
    }
  }
}

async function annotate(lines, scheduler, script) {
  for (let line of lines) {
    const card = await scheduler.getCard(line);
    script.annotate(line, card.ease, card.streak, card.due);
  }
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
    script.cycleVisibility(line);
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
    const ids = new Map();
    for (const line of lines) {
      const id = line.id;
      const text = this.#extractText(line);
      if (ids.has(id)) {
        console.error(`Id ${id} shared by lines:\n${ids.get(id)}\n${text}`);
      } else {
        ids.set(id, text);
      }
    }
    return Array.from(ids.keys());
  }

  scenes() {
    const firstLines = [];
    for (const heading of document.getElementsByTagName("H1")) {
      const line = heading.nextElementSibling;
      console.assert(line.tagName === "P");
      firstLines.push(line.id);
    }
    return firstLines;
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
      lines.length < count && line && line.tagName === "P";
      line = line.nextElementSibling
    ) {
      lines.push(line.id);
    }

    return lines;
  }

  lowlight(lines) {
    for (const line of lines) {
      const elem = document.getElementById(line);
      elem.classList.add("review-line");
    }
  }

  unlowlight(lines) {
    for (const line of lines) {
      const elem = document.getElementById(line);
      elem.classList.remove("review-line");
    }
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

  cycleVisibility(line) {
    const elem = document.getElementById(line);

    // Find the singular current visibility class
    const visClasses = Array.from(elem.classList).filter((c) =>
      Script.visibilityClasses.includes(c),
    );
    console.assert(visClasses.length == 1);
    const oldVis = visClasses[0];

    // Calculate the increased visibility
    const oldIndex = Script.visibilityClasses.indexOf(oldVis);
    var newIndex;
    if (oldIndex === Script.visibilityClasses.length - 1) {
      newIndex = 0;
    } else {
      newIndex = oldIndex + 1;
    }
    var newVis = Script.visibilityClasses[newIndex];
    if (newVis == "show-line-initials") {
      newVis = "show-word-initials";
    }

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

  annotate(line, ease, streak, due) {
    const annotation = this.#getAnnotation(line);
    annotation.innerHTML = `[${ease}, ${streak}, ${due}]`;
  }

  deannotate(lines) {
    for (const line of lines) {
      const annotation = this.#getAnnotation(line);
      annotation.innerHTML = "";
    }
  }

  #getAnnotation(line) {
    const elem = document.getElementById(line);
    const annotations = elem.getElementsByClassName("annotation");
    console.assert(annotations.length == 1);
    return annotations[0];
  }

  #setVisibility(lines, visibility) {
    for (let line of lines.flat()) {
      const elem = document.getElementById(line);
      elem.classList.remove(...Script.visibilityClasses);
      elem.classList.add(visibility);
    }
  }

  #extractText(line) {
    const clone = line.cloneNode(true);
    clone.classList.remove(...Script.visibilityClasses);
    return clone.innerText;
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

function now() {
  return new Date();
}

function isToday(date) {
  if (typeof date !== "string") {
    date = dateOnly(date);
  }
  return date === today();
}

function today() {
  return dateOnly(new Date());
}

function daysFromToday(days) {
  return dateOnly(addDays(days, new Date()));
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(days, date) {
  const newDate = new Date(date);
  newDate.setDate(date.getDate() + days);
  return newDate;
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

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
