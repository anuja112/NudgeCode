
const API_URL = "http://localhost:5000/api/hint";
const NAMES = { 1: "Nudge", 2: "Direction", 3: "Blueprint" };

const tabs = [...document.querySelectorAll(".tab")];
const panelEl = document.getElementById("panel");
const statusEl = document.getElementById("status");
const problemEl = document.getElementById("problem");
const approachEl = document.getElementById("approach");

let slug = null;
let hints = {};
let active = 1;
let busy = false;

init();

// 1. Initialize extension
async function init() {
    const tab = await getActiveTab();
    slug = tab?.url?.match(/leetcode\.com\/problems\/([^/?#]+)/)?.[1] ?? null;

    if (!slug) {
        problemEl.textContent = "No problem detected";
        setStatus("Open a LeetCode problem page first.", true);
        render();
        return;
    }

    problemEl.textContent = slug.replace(/-/g, " ");

    // Restore saved hints
    const saved = (await chrome.storage.local.get(slug))[slug] || {};

    for (const [level, hint] of Object.entries(saved)) {
        if (hint && typeof hint === "object" && Array.isArray(hint.points)) {
        hints[level] = hint;
        }
    }

    const levels = Object.keys(hints).map(Number);
    if (levels.length) active = Math.max(...levels);

    render();
}

// 2. Tab click events
tabs.forEach(tab => {
    tab.addEventListener("click", () => {
        active = Number(tab.dataset.level);
        render();
    });
});

// 3. Reset all hints
document.getElementById("reset").addEventListener("click", async () => {
    if (!slug) return;

    hints = {};
    active = 1;

    await chrome.storage.local.remove(slug);
    setStatus("");
    render();
});

// 4. Get hint from backend
async function getHint(level) {
    busy = true;
    active = level;
    setStatus("Thinking...");
    render();

    let timer;

    try {
        const tab = await getActiveTab();

        // Extract problem details from LeetCode
        const [{ result: problem }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractProblemData
    });

    // Set 20-second timeout
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 20000);

    // Send request to backend
    const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
            problemTitle: problem.title,
            problemDescription: problem.description,
            difficulty: problem.difficulty,
            hintLevel: level,
            userApproach: approachEl.value,

            previousHints: Object.entries(hints)
            .filter(([l]) => Number(l) < level)
            .map(([, h]) => [h.key, ...h.points].join("\n"))
        })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");

    // Save new hint
    hints[level] = { key: data.key, points: data.points };
    await chrome.storage.local.set({ [slug]: hints });

    setStatus("");

    } catch (err) {
        const msg = err.name === "AbortError"
        ? "Timed out - is the backend running?"
        : err.message;

        setStatus(
        msg === "Failed to fetch"
            ? "Can't reach backend. Run `npm start` in /backend."
            : msg,
        true
        );

    } finally {
        clearTimeout(timer);
        busy = false;
        render();
    }
}

// 5. Render tabs and hint panel
function render() {
    tabs.forEach(tab => {
        const level = Number(tab.dataset.level);

        tab.classList.toggle("active", level === active);
        tab.classList.toggle("done", Boolean(hints[level]));

        // Unlock hint N only after hint N-1
        tab.disabled = !slug || busy || (level > 1 && !hints[level - 1]);
    });

    panelEl.replaceChildren();

    if (!slug || (busy && !hints[active])) return;

    panelEl.appendChild(
        hints[active] ? buildCard(hints[active]) : buildEmpty()
    );
}

// 6. Display empty hint section
function buildEmpty() {
    const box = document.createElement("div");
    box.className = "empty";

    const text = document.createElement("p");
    text.textContent = `Hint ${active} · ${NAMES[active]} hasn't been revealed yet.`;

    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = `Reveal hint ${active}`;
    btn.addEventListener("click", () => getHint(active));

    box.append(text, btn);
    return box;
}

// 7. Display generated hint card
function buildCard(hint) {
    const card = document.createElement("div");
    card.className = "card";

    const key = document.createElement("div");
    key.className = "key";
    addRichText(key, hint.key);

    const list = document.createElement("ul");

    hint.points.forEach(point => {
        const li = document.createElement("li");
        addRichText(li, point);
        list.appendChild(li);
    });

    const actions = document.createElement("div");
    actions.className = "actions";

    // Regenerate current hint
    const again = document.createElement("button");
    again.className = "link";
    again.textContent = "Regenerate";
    again.addEventListener("click", () => getHint(active));
    actions.appendChild(again);

    // Move to next hint
    if (active < 3) {
        const next = document.createElement("button");
        next.className = "btn";
        next.textContent = `Next: ${NAMES[active + 1]} →`;

        next.addEventListener("click", () => {
        const nextLevel = active + 1;

        if (hints[nextLevel]) {
            active = nextLevel;
            render();
        } else {
            getHint(nextLevel);
        }
        });

        actions.appendChild(next);
    }

    card.append(key, list, actions);
    return card;
}

// 8. Convert **bold** text into safe HTML elements
function addRichText(el, text = "") {
    text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => {
        if (!part) return;

        if (i % 2) {
        const strong = document.createElement("strong");
        strong.textContent = part;
        el.appendChild(strong);
        } else {
        el.appendChild(document.createTextNode(part));
        }
    });
}

// 9. Update status message
function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle("error", isError);
}

// 10. Get currently active browser tab
async function getActiveTab() {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    return tab;
}

// 11. Extract problem details from LeetCode page
function extractProblemData() {
    const title =
        document.querySelector("h1")?.innerText ||
        document.title.replace(/ - LeetCode.*/, "") ||
        "Unknown Title";

    const description =
        document.querySelector('[data-track-load="description_content"]')?.innerText || "";

    const difficulty =
        document.querySelector('[class*="text-difficulty"]')?.innerText || "Unknown";

    return { title, description, difficulty };
}
