import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

export async function push(message: string) {
    const token = process.env.PUSHOVER_TOKEN;
    const user = process.env.PUSHOVER_USER;

    if (!token || !user) {
        console.error('❌ Missing Pushover token or user key.');
        return;
    }

    try {
        const response = await fetch('https://api.pushover.net/1/messages.json', {
            method: 'POST',
            body: new URLSearchParams({
                token,
                user,
                message,
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('❌ Pushover failed:', result);
        } else {
            console.log('✅ Pushover sent:', result);
        }
    } catch (err) {
        console.error('❌ Pushover error:', err);
    }
}
