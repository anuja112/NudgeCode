const output = document.getElementById("output");

document.getElementById("hintBtn").addEventListener("click", async () => {
    output.textContent = "Thinking...";
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        const [{ result: problem }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractProblemData,
        });

        const res = await fetch("http://localhost:5000/api/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            problemTitle: problem.title,
            problemDescription: problem.description,
        }),
        });
        const data = await res.json();
        output.textContent = data.hint;
    } catch (err) {
        output.textContent = "Error: " + err.message;
    }
    });

    function extractProblemData() {
    return {
        title: document.querySelector("h1")?.innerText || document.title,
        description:
        document.querySelector('[data-track-load="description_content"]')?.innerText || "",
    };
}