// Get all steps and lines
const steps = document.querySelectorAll(".progress-step");
const lines = document.querySelectorAll(".line");

let currentStep = 0;

// Function to update active step
function updateProgress() {
  // Remove active classes from all steps
  steps.forEach((step, index) => {
    step.classList.remove("active");
    if (lines[index]) lines[index].classList.remove("inactive");
  });

  // Add active class to current step
  for (let i = 0; i <= currentStep; i++) {
    steps[i].classList.add("inactive");
    if (lines[i]) lines[i].classList.add("inactive");
  }

  // Move to next step
  currentStep++;

  // Loop back when reaching last step
  if (currentStep >= steps.length) {
    currentStep = 0;
  }
}

// Update progress every 2 seconds
setInterval(updateProgress, 3000);

// Initialize first state
updateProgress();
