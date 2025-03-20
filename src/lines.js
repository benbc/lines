document.addEventListener("keydown", function (event) {
  if (event.key === "ArrowRight") {
    selectNextLine();
  } else if (event.key === "ArrowLeft") {
    selectPreviousLine();
  }
});

function selectLine(dirFn) {
  const currentLine = document.querySelector("p.current-line");
  const siblingLine = dirFn(currentLine);
  if (!siblingLine || siblingLine.tagName !== "P") return;
  currentLine.classList.remove("current-line");
  siblingLine.classList.add("current-line");
}

function selectNextLine() {
  selectLine((line) => line.nextElementSibling);
}

function selectPreviousLine() {
  selectLine((line) => line.previousElementSibling);
}
