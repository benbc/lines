window.addEventListener("keydown", function (e) {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
  }
});

document.addEventListener("keydown", function (event) {
  if (event.key === "ArrowRight") {
    selectNextLine();
  } else if (event.key === "ArrowLeft") {
    selectPreviousLine();
  } else if (event.key === "ArrowDown") {
    displayCurrentLine();
  } else if (event.key === "ArrowUp") {
    screenCurrentLine();
  }
});

function selectLine(dirFn) {
  const currentLine = document.querySelector("p.current-line");
  const siblingLine = dirFn(currentLine);
  if (!siblingLine || siblingLine.tagName !== "P") return;
  currentLine.classList.remove("current-line");
  siblingLine.classList.add("current-line");
  siblingLine.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

function selectNextLine() {
  selectLine((line) => line.nextElementSibling);
}

function selectPreviousLine() {
  selectLine((line) => line.previousElementSibling);
}

function displayCurrentLine() {
  const currentLine = document.querySelector("p.current-line");
  currentLine.classList.add("display");
}

function screenCurrentLine() {
  const currentLine = document.querySelector("p.current-line");
  currentLine.classList.remove("display");
}
