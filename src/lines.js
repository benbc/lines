window.addEventListener("keydown", function (e) {
  if (["ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
  }
});

document.addEventListener("keydown", function (event) {
  if (event.key === "ArrowRight") {
    selectNextLine();
  } else if (event.key === "ArrowLeft") {
    selectPreviousLine();
  } else if (event.key === "ArrowDown") {
    toggleLineDisplay();
  }
});

function selectLine(dirFn) {
  const currentLine = document.querySelector("p.current-line");
  const siblingLine = dirFn(currentLine);
  if (!siblingLine || siblingLine.tagName !== "P") return;
  currentLine.classList.remove("current-line");
  currentLine.classList.remove("display");
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

function toggleLineDisplay() {
  const currentLine = document.querySelector("p.current-line");
  if (currentLine.classList.contains("display")) {
    currentLine.classList.remove("display");
  } else {
    currentLine.classList.add("display");
  }
}
