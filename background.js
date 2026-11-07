const KEY = "YOUR_KEY";
const MODEL = "gemini-2.5-flash"; // swap for the current Flash name

async function judge(task, title, url) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text:
          `User's task: ${task}\nCurrent tab: ${title} (${url})\nIs this on task? Reply as JSON: {"on_task": boolean, "message": string}` }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    }
  );
  const data = await res.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

judge("finish CMPT assignment", "YouTube - lofi beats", "youtube.com").then(console.log);