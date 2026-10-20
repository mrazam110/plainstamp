import "./doc.css";

// Follow the theme chosen in the app (read only; nothing is written or sent).
try {
  const theme = JSON.parse(localStorage.getItem("plainstamp.v1.settings") ?? "{}").theme;
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch { /* storage blocked or unreadable: stay on the system theme */ }
