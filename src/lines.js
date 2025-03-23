window.addEventListener("load", (_) => control());

async function control() {
  while (true) {
    var event = await keyPress("ArrowLeft", "ArrowRight", "ArrowDown", "l");
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
        await learnLine();
        break;
    }
  }
}

async function learnLine() {
  var chunkSize = 3;
  var linesAbove = Math.min(chunkSize - 1, countLinesAbove());
  var linesBelow = Math.min(chunkSize - 1, countLinesBelow());
  moveBack(linesAbove);
  for (var i = 0; i < linesAbove + 1 + linesBelow; i++) {
    learnChunk(chunkSize);
    moveForward(1);
  }
}

async function learnChunk(fullChunkSize) {
  chunkSize = Math.min(fullChunkSize, countLinesAbove() + 1);
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
  currentHeading = findPrevious(currentLine, "H1");

  heading = dir(currentHeading, "H1");
  if (!heading) return;

  firstLine = findNext(heading, "P");
  deselectLine(currentLine);
  selectLine(firstLine);
}

function findNext(from, tag) {
  next = from;
  while ((next = next.nextElementSibling)) {
    if (next.tagName === tag) {
      return next;
    }
  }
}

function findPrevious(from, tag) {
  next = from;
  while ((next = next.previousElementSibling)) {
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
