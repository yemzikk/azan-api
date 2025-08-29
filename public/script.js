const locationSelect = document.getElementById("location");
const viewSelect = document.getElementById("view");
const loadBtn = document.getElementById("load-data");
const resultsDiv = document.getElementById("results");
const monthInputDiv = document.getElementById("month-input");
const monthInput = document.getElementById("month");

// Predefined locations (you can later auto-generate this from your output folders)
const locations = ["Kuttiady Assembly Constituency"];

// Populate location dropdown
locations.forEach((loc) => {
  const opt = document.createElement("option");
  opt.value = loc;
  opt.textContent = loc;
  locationSelect.appendChild(opt);
});

// Show/hide month input
viewSelect.addEventListener("change", () => {
  monthInputDiv.style.display =
    viewSelect.value === "specific-month" ? "block" : "none";
});

loadBtn.addEventListener("click", async () => {
  const location = locationSelect.value;
  const view = viewSelect.value;
  const month = monthInput.value;

  let fileName = "";
  if (view === "today") {
    fileName = "today.json";
  } else if (view === "month" || view === "specific-month") {
    fileName = "month.json";
  } else if (view === "year") {
    fileName = "year.json";
  }

  const response = await fetch(`/output/${location}/${fileName}`);
  const data = await response.json();
  let output = "";

  if (view === "today") {
    output = `<h3>Today's Prayer Times</h3>` + makeTable(data);
  }

  if (view === "month") {
    output = `<h3>Prayer Times for Current Month</h3>` + makeTable(data);
  }

  if (view === "specific-month") {
    const filtered = data.filter(d => d.month === parseInt(month));
    output = `<h3>Prayer Times for Month ${month}</h3>` + makeTable(filtered);
  }

  if (view === "year") {
    output = `<h3>Prayer Times for Full Year</h3>` + makeTable(data);
  }

  resultsDiv.innerHTML = output;
});

function makeTable(arr) {
  if (!arr || arr.length === 0) return "<p>No data available</p>";
  let headers = Object.keys(arr[0]);
  let html = "<table><thead><tr>";
  headers.forEach((h) => (html += `<th>${h}</th>`));
  html += "</tr></thead><tbody>";
  arr.forEach((row) => {
    html += "<tr>";
    headers.forEach((h) => (html += `<td>${row[h]}</td>`));
    html += "</tr>";
  });
  html += "</tbody></table>";
  return html;
}
