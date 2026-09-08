import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Notifications for contact requests and unanswered questions.
 *
 * Dispatches to every configured channel. Channels enable themselves when
 * their credentials are present — there is deliberately no NOTIFY_CHANNELS
 * list to keep in sync, because the failure mode that actually bit this
 * project was a channel silently doing nothing while the code reported
 * success.
 *
 * Email is the recommended channel: unlike a push notification, a missed
 * email is still sitting in the inbox, searchable. That matters here, since
 * the log of what visitors ask is the most valuable output of the project.
 *
 * SMTP works with Gmail (app password), Brevo, or any other provider, so
 * switching providers is a config change rather than a code change.
 */

export interface NotifyResult {
    delivered: string[];
    failed: string[];
    skipped: boolean;
}

let transporter: Transporter | null = null;

function emailConfigured(): boolean {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Pushover remains supported as an extra channel and activates on its own if
 * both variables are set. Left out of .env.example deliberately: email covers
 * this, and Pushover costs $4.99 per platform once its 30-day trial ends.
 */
function pushoverConfigured(): boolean {
    return Boolean(process.env.PUSHOVER_TOKEN && process.env.PUSHOVER_USER);
}

function getTransporter(): Transporter {
    if (transporter) return transporter;

    const port = Number(process.env.SMTP_PORT ?? 587);

    // Google displays App Passwords in four space-separated groups
    // ("abcd efgh ijkl mnop"). Pasted as shown, authentication fails with a
    // generic "username and password not accepted", which reads like the
    // wrong password rather than a formatting problem. Strip whitespace.
    const pass = process.env.SMTP_PASS?.replace(/\s+/g, '');

    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        // 465 is implicit TLS; 587 upgrades via STARTTLS.
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass },
    });

    return transporter;
}

async function sendEmail(subject: string, body: string): Promise<void> {
    // NOTIFY_EMAIL_TO and SMTP_FROM are supported but intentionally left out of
    // .env.example: both default to SMTP_USER, which is what you want when the
    // sender and recipient are the same person. Set them only to send somewhere
    // other than the sending account.
    const to = process.env.NOTIFY_EMAIL_TO || process.env.SMTP_USER;
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;

    await getTransporter().sendMail({ from, to, subject, text: body });
}

async function sendPushover(message: string): Promise<void> {
    const response = await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        body: new URLSearchParams({
            token: process.env.PUSHOVER_TOKEN!,
            user: process.env.PUSHOVER_USER!,
            message,
        }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!response.ok) throw new Error(`Pushover ${response.status}: ${await response.text()}`);
}

/**
 * Sends to every configured channel. Never throws: a notification failure must
 * not surface to the visitor or break a live Q&A.
 */
export async function notify(subject: string, body: string): Promise<NotifyResult> {
    // Eval runs execute the real tools; don't send 30 real notifications.
    // Set only by the eval runner — never document it as a config option, as
    // setting it in a real environment silently disables all notifications.
    if (process.env.EVAL_MODE === '1') {
        console.log('  [eval] notification suppressed:', subject);
        return { delivered: [], failed: [], skipped: true };
    }

    const channels: { name: string; send: () => Promise<void> }[] = [];

    if (emailConfigured()) {
        channels.push({ name: 'email', send: () => sendEmail(subject, body) });
    }
    if (pushoverConfigured()) {
        channels.push({ name: 'pushover', send: () => sendPushover(`${subject}\n\n${body}`) });
    }

    if (channels.length === 0) {
        console.error(
            `❌ No notification channel configured — dropping: ${subject}\n` +
            '   Set SMTP_HOST/SMTP_USER/SMTP_PASS (see server/.env.example).',
        );
        return { delivered: [], failed: [], skipped: false };
    }

    const delivered: string[] = [];
    const failed: string[] = [];

    await Promise.all(
        channels.map(async channel => {
            try {
                await channel.send();
                delivered.push(channel.name);
                console.log(`✅ Notified via ${channel.name}: ${subject}`);
            } catch (err) {
                failed.push(channel.name);
                console.error(`❌ ${channel.name} notification failed:`, err);
            }
        }),
    );

    return { delivered, failed, skipped: false };
}

/**
 * Verifies the SMTP connection and credentials without sending anything.
 * Used by the config check so a broken setup is found before it matters.
 */
export async function verifyNotificationChannels(): Promise<void> {
    if (!emailConfigured() && !pushoverConfigured()) {
        console.warn('⚠️ No notification channel configured. Contact capture will be dropped.');
        return;
    }

    if (emailConfigured()) {
        try {
            await getTransporter().verify();
            console.log('✅ SMTP connection verified.');
        } catch (err) {
            console.error('❌ SMTP verification failed:', err instanceof Error ? err.message : err);
        }
    }

    if (pushoverConfigured()) console.log('✅ Pushover configured.');
}
