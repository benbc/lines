window.addEventListener("load", (_) => control());

async function control() {
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
        flagLearning();
        await learnLine();
        unflagLearning();
        break;
    }
  }
}

async function learnLine() {
  const fullChunkSize = 5;
  const maxLinesAbove = Math.min(fullChunkSize - 1, countLinesAbove());
  const maxLinesBelow = Math.min(fullChunkSize - 1, countLinesBelow());

  for (var linesAbove = maxLinesAbove; linesAbove >= 0; linesAbove--) {
    var linesBelow = Math.min(fullChunkSize - 1 - linesAbove, maxLinesBelow);
    var chunkSize = linesAbove + 1 + linesBelow;
    await learnChunk(chunkSize);
    moveForward(1);
  }
}

async function learnChunk(chunkSize) {
  for (var fragmentSize = 1; fragmentSize <= chunkSize; fragmentSize++) {
    moveBack(fragmentSize - 1);
    await learnFragment(fragmentSize);
  }
}

async function learnFragment(size) {
  for (var i = 0; i < size; i++) {
    await checkLine();
    moveForward(1);
  }
  moveBack(1);
}

async function checkLine() {
  if ((await keyPress(".", "m")).key === "m") {
    displayCurrentLine();
    await keyPress(".", "m");
    hideCurrentLine();
  }
}

function moveForward(lines) {
  for (var i = 0; i < lines; i++) {
    selectNextLine();
  }
}

function moveBack(lines) {
  for (var i = 0; i < lines; i++) {
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
  var next = from;
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
  var count = 0;
  for (var next = getCurrentLine(); next.tagName === "P"; next = dir(next)) {
    count++;
  }
  return count - 1; // count includes current element
}

function getCurrentLine() {
  return document.querySelector("p.current-line");
}

function flagLearning() {
  rule = getCurrentLineRule();
  rule.style.setProperty("background-color", "linen");
}

function unflagLearning() {
  rule = getCurrentLineRule();
  rule.style.removeProperty("background-color", "linen");
}

function getCurrentLineRule() {
  return [...document.styleSheets[0].cssRules].find(
    (r) => r.selectorText === ".current-line",
  );
}
