window.addEventListener("keydown", function (e) {
  if (["ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
  }
});

document.addEventListener("keydown", function (event) {
  if (event.ctrlKey) {
    if (event.key === "ArrowRight") {
      nextScene();
    } else if (event.key === "ArrowLeft") {
      previousScene();
    }
  } else {
    if (event.key === "ArrowRight") {
      selectNextLine();
    } else if (event.key === "ArrowLeft") {
      selectPreviousLine();
    } else if (event.key === "ArrowDown") {
      toggleLineDisplay();
    }
  }
});

function nextScene() {
  return moveScene(findNext);
}

function previousScene() {
  return moveScene(findPrevious);
}

function moveScene(dir) {
  const currentLine = document.querySelector("p.current-line");
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
  const currentLine = document.querySelector("p.current-line");
  const siblingLine = dirFn(currentLine);
  if (!siblingLine || siblingLine.tagName !== "P") return;
  deselectLine(currentLine);
  selectLine(siblingLine);
}

function deselectLine(line) {
  line.classList.remove("current-line");
  line.classList.remove("display");
}

function selectLine(line) {
  line.classList.add("current-line");
  line.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

function toggleLineDisplay() {
  const currentLine = document.querySelector("p.current-line");
  if (currentLine.classList.contains("display")) {
    currentLine.classList.remove("display");
  } else {
    currentLine.classList.add("display");
  }
}
