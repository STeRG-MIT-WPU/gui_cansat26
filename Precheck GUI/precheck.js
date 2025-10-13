
const buttons = document.querySelectorAll(".checks-label");

buttons.forEach(btn => {
  let isCyan = false; // toggle state for each button

  btn.addEventListener("click", () => {
    if (isCyan) {
      // Red glow
      btn.style.color = "red";
      btn.style.textShadow = "  red";
      isCyan = false;
    } else {
      // Cyan glow
      btn.style.color = "#00C8D7";
      btn.style.textShadow = "   #00C8D7";
      isCyan = true;
    }
  });
});