// dataLoaders.ts
import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import fetch from 'node-fetch';

export async function getSummaryText(): Promise<string> {
    const summaryPath = path.join(__dirname, 'data', 'summary.txt');
    const summary = await fs.readFile(summaryPath, 'utf-8');
    return summary.trim();
}

export async function getLinkedInText(): Promise<string> {
    const pdfPath = path.join(__dirname, 'data', 'linkedin', 'linkedin.pdf');
    const pdfBuffer = await fs.readFile(pdfPath);
    const parsed = await pdfParse(pdfBuffer);
    return parsed.text.trim();
}

export async function getResumeText(): Promise<string> {
    const pdfPath = path.join(__dirname, 'data', 'resume', 'FanKaiweiResume_20241106.pdf');
    const pdfBuffer = await fs.readFile(pdfPath);
    const parsed = await pdfParse(pdfBuffer);
    return parsed.text.trim();
}

export async function getCertificatesText(): Promise<string> {
    const certDir = path.join(__dirname, 'data', 'Certificates');
    let text = '';

    try {
        const files = await fs.readdir(certDir);
        const pdfFiles = files.filter(file => file.endsWith('.pdf'));

        if (pdfFiles.length === 0) return 'No certificates found.';
        console.log('pdfFiles', pdfFiles.length)

        for (const file of pdfFiles) {
            const pdfPath = path.join(certDir, file);
            const pdfBuffer = await fs.readFile(pdfPath);
            const parsed = await pdfParse(pdfBuffer);
            text += `\n\n📄 Certificate: ${file}\n${parsed.text.trim()}`;
        }
    } catch {
        text += '\n(No certificates found or failed to read.)';
    }

    return text.trim();
}

export async function fetchAllGithubRepos(username: string): Promise<string> {
    const perPage = 100;
    let page = 1;
    let allRepos: any[] = [];

    while (true) {
        const res = await fetch(`https://api.github.com/users/${username}/repos?per_page=${perPage}&page=${page}`);
        if (!res.ok) return 'Failed to fetch GitHub repositories.';

        const data = await res.json();

        if (!Array.isArray(data) || data.length === 0) break;

        allRepos = [...allRepos, ...data];
        if (data.length < perPage) break;

        page++;
    }

    if (allRepos.length === 0) return 'No repositories found on GitHub.';

    return allRepos
        .map(repo => `- ${repo.name}: ${repo.description || 'No description'}`)
        .join('\n');
}

// Export a combined loader to fetch everything at once
export async function loadAllProfileData(githubUsername: string) {
    const summary = await getSummaryText();
    const linkedin = await getLinkedInText();
    const resume = await getResumeText();
    const certificates = await getCertificatesText();
    const github = await fetchAllGithubRepos(githubUsername);

    return { summary, linkedin, resume, certificates, github };
}
