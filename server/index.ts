import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ===== 🔹 Initialize OpenAI =====
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ===== 🔹 File Readers =====

async function getSummaryText(): Promise<string> {
    const summaryPath = path.join(__dirname, 'data', 'summary.txt');
    const summary = await fs.readFile(summaryPath, 'utf-8');
    return summary.trim();
}

async function getLinkedInText(): Promise<string> {
    const pdfPath = path.join(__dirname, 'data', 'linkedin', 'linkedin.pdf');
    const pdfBuffer = await fs.readFile(pdfPath);
    const parsed = await pdfParse(pdfBuffer);
    return parsed.text.trim();
}

async function getResumeText(): Promise<string> {
    const pdfPath = path.join(__dirname, 'data', 'resume', 'FanKaiweiResume_20241106.pdf');
    const pdfBuffer = await fs.readFile(pdfPath);
    const parsed = await pdfParse(pdfBuffer);
    return parsed.text.trim();
}

async function getCertificatesText(): Promise<string> {
    const certDir = path.join(__dirname, 'data', 'Certificates');
    let text = '';

    console.log('🔍 Checking for certificates at:', certDir);

    try {
        const files = await fs.readdir(certDir);
        console.log('📂 Certificate files found:', files);

        const pdfFiles = files.filter(file => file.endsWith('.pdf'));

        if (pdfFiles.length === 0) {
            console.log('⚠️ No PDF certificates found in directory.');
            return 'No certificates found.';
        }

        for (const file of pdfFiles) {
            const pdfPath = path.join(certDir, file);
            const pdfBuffer = await fs.readFile(pdfPath);
            const parsed = await pdfParse(pdfBuffer);
            text += `\n\n📄 Certificate: ${file}\n${parsed.text.trim()}`;
        }
    } catch (err) {
        console.error('❌ Error reading certificates:', err);
        text += '\n(No certificates found or failed to read.)';
    }

    return text.trim();
}

// ===== 🔹 GitHub Fetcher =====

async function fetchAllGithubRepos(username: string): Promise<string> {
    const perPage = 100;
    let page = 1;
    let allRepos: any[] = [];

    while (true) {
        const res = await fetch(`https://api.github.com/users/${username}/repos?per_page=${perPage}&page=${page}`);
        if (!res.ok) {
            console.error(`❌ GitHub API request failed: ${res.status} ${res.statusText}`);
            return 'Failed to fetch GitHub repositories.';
        }

        const data = await res.json();

        if (!Array.isArray(data) || data.length === 0) break;

        allRepos = [...allRepos, ...data];
        if (data.length < perPage) break;

        page++;
    }

    if (allRepos.length === 0) {
        return 'No repositories found on GitHub.';
    }

    const repoDescriptions = allRepos.map(repo =>
        `- ${repo.name}: ${repo.description || 'No description'}`
    ).join('\n');

    console.log('📂 GitHub repo descriptions:', repoDescriptions);

    return `GitHub Repositories for ${username}:\n${repoDescriptions}`;
}

// ===== 🔹 Chat Route =====

app.post('/chat', async (req: Request, res: Response) => {
    const { userMessage } = req.body;
    const name = 'Fan Kaiwei';
    const githubUsername = 'kaiweifan11';

    if (!userMessage) {
        return res.status(400).json({ error: 'Missing "userMessage".' });
    }

    try {
        const summary = await getSummaryText();
        const linkedin = await getLinkedInText();
        const resume = await getResumeText();
        const certificates = await getCertificatesText();
        const github = await fetchAllGithubRepos(githubUsername);

        const system_prompt = `
You are acting as ${name}. You are answering questions on ${name}'s website,
particularly questions related to ${name}'s career, background, skills, and experience.
Your responsibility is to represent ${name} for interactions on the website as faithfully as possible.
You are given a summary of ${name}'s background, LinkedIn profile, resume, GitHub repositories, and certificates.
Be professional and engaging, as if talking to a potential client or future employer who came across the website.
If you don't know the answer, say so.

## Summary:
${summary}

## LinkedIn Profile:
${linkedin}

## Resume:
${resume}

## GitHub:
${github}

## Certificates:
${certificates}

With this context, please chat with the user, always staying in character as ${name}.
`;

        const chatResponse = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: system_prompt },
                { role: 'user', content: userMessage },
            ],
        });

        const reply = chatResponse.choices[0]?.message?.content || "I'm not sure how to respond.";
        res.json({ reply });

    } catch (error: any) {
        console.error('❌ Error:', error.message || error);
        res.status(500).json({ error: 'Something went wrong reading the files or talking to OpenAI.' });
    }
});

// ===== 🔹 Start Server =====

app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
});
