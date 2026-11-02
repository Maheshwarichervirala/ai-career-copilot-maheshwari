// Vercel serverless function: POST /api/analyze
// The Gemini API key lives in the GEMINI_API_KEY environment variable on Vercel,
// so it never appears in the browser or in the GitHub repo.

const SYSTEM_PROMPT = `You are a campus recruiter with 10+ years of experience hiring freshers and interns at top Indian tech companies. You know that fresh graduates have little work experience, so you judge them on projects, internships, skills, and learning potential.

Your task: Analyze the candidate's resume against the job description. Judge fairly for a fresher, and give detailed, actionable feedback.

You MUST return your analysis as a valid JSON object with these exact fields:
{
  "ats_score": <number 0-100, where 100 is perfect match>,
  "summary": "<2-3 sentence overall assessment, specific and data-backed>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>", "<strength 4>"],
  "missing_keywords": ["<keyword 1>", "<keyword 2>", "<keyword 3>", "<keyword 4>", "<keyword 5>"],
  "improvements": ["<specific actionable improvement 1>", "<specific actionable improvement 2>", "<specific actionable improvement 3>"]
}

Rules:
- Be SPECIFIC and DATA-BACKED. Use numbers where possible (e.g., "3 years experience" not "good experience")
- Focus on ACTIONABLE advice, not generic feedback
- missing_keywords must be actual keywords from the job description that are NOT in the resume
- missing_keywords must be skills, tools, or concepts copied from the job description. Never list the job title, never invent phrases, and never list a keyword if the resume already has its singular, plural, or a close variant (e.g. "dashboard" counts as "dashboards")
- If fewer than 5 keywords are truly missing, return fewer. Do not pad the list
- strengths must highlight what the resume does WELL
- improvements must be specific changes the candidate can make
- Keep each item concise (1-2 sentences max)
- If information is missing, note it as a gap
- Give extra credit for projects, internships, certifications, and measurable results (accuracy, users, time saved)
- Do not penalize missing years of experience if the role is entry-level
- Suggest 1 concrete project the candidate could build to close the biggest skill gap
- Do NOT include any text outside the JSON object`;

const MODEL = "gemini-3.8-flash";
const MAX_CHARS = 15000;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing GEMINI_API_KEY. Add it in Vercel project settings and redeploy." });
  }

  const { resume, jobDesc } = req.body || {};
  if (typeof resume !== "string" || typeof jobDesc !== "string" || !resume.trim() || !jobDesc.trim()) {
    return res.status(400).json({ error: "Both resume and job description are required." });
  }
  if (resume.length > MAX_CHARS || jobDesc.length > MAX_CHARS) {
    return res.status(400).json({ error: "Text is too long. Keep each field under 15,000 characters." });
  }

  const userPrompt = `Resume:\n${resume}\n\nJob Description:\n${jobDesc}\n\nProvide your analysis as a JSON object with the exact fields specified.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: SYSTEM_PROMPT + "\n\n" + userPrompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return res.status(502).json({ error: data.error?.message || `Gemini error ${response.status}` });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return res.status(502).json({ error: "Empty response from AI." });

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(502).json({ error: "AI did not return valid JSON." });

    const analysis = JSON.parse(match[0]);
    if (analysis.ats_score === undefined || !analysis.strengths || !analysis.improvements) {
      return res.status(502).json({ error: "AI response was missing required fields." });
    }

    return res.status(200).json({ analysis });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
