/**
 * Pushover notification for contact requests and unanswered questions.
 *
 * Phase 2 should add a second channel here — Pushover-only means there is no
 * queryable record of who got in touch.
 */
export async function push(message: string): Promise<void> {
    // Eval runs execute the real tools; don't page Kaiwei 30 times for them.
    // Set only by the eval runner — never document it as a config option, as
    // setting it in a real environment silently disables all notifications.
    if (process.env.EVAL_MODE === '1') {
        console.log('  [eval] push suppressed:', message);
        return;
    }

    const token = process.env.PUSHOVER_TOKEN;
    const user = process.env.PUSHOVER_USER;

    if (!token || !user) {
        console.error('❌ Missing Pushover token or user key.');
        return;
    }

    try {
        const response = await fetch('https://api.pushover.net/1/messages.json', {
            method: 'POST',
            body: new URLSearchParams({ token, user, message }),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        if (!response.ok) {
            console.error('❌ Pushover failed:', await response.text());
        }
    } catch (err) {
        console.error('❌ Pushover error:', err);
    }
}
