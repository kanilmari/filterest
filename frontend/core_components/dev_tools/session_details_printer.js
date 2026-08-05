// session_details_printer.js
// Fetches and displays current session details from the backend for debugging.
// Bridges sessioninfo API responses and the session debug container in the UI.
// Exists to help developers inspect current session state and user context.
// import { count_this_function } from "./function_counter.js";
// export async function fetchAndDisplaySession() {
//     count_this_function("fetchAndDisplaySession");
//     try {
//         const response = await fetch("/api/sessioninfo");
//         if (!response.ok) {
//             console.error("Virhe fetchissä /api/sessioninfo");
//             return;
//         }

//         const sessionData = await response.json();
//         const sessionDebugElement = document.getElementById("session_debug");

//         if (sessionDebugElement) {
//             // Tyhjennetään elementti ja lisätään pieni otsikko
//             sessionDebugElement.innerHTML = "";

//             const heading = document.createElement("div");
//             heading.classList.add("sessionDebugHeader"); // Tyylitellään CSS:ssä
//             heading.textContent = "Session keys";
//             sessionDebugElement.appendChild(heading);

//             // Luodaan lista
//             const listEl = document.createElement("ul");
//             listEl.classList.add("sessionDebugList"); // Tyylitellään CSS:ssä

//             // Käydään läpi sessionData-olio
//             Object.keys(sessionData).forEach((key) => {
//                 const listItem = document.createElement("li");
//                 listItem.classList.add("sessionDebugItem"); // Tyylitellään CSS:ssä
//                 listItem.textContent = key;
//                 listEl.appendChild(listItem);
//             });

//             sessionDebugElement.appendChild(listEl);
//         }
//     } catch (err) {
//         console.error("fetchAndDisplaySession -virhe:", err);
//     }
// }

// window.addEventListener("DOMContentLoaded", () => {
//     fetchAndDisplaySession();
// });
