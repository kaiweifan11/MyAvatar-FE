import { useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { MAX_MESSAGE_LENGTH, type Deck } from '@myavatar/shared';
import { parseDeck } from '../deck/parseDeck';
import './present.css';

const apiUrl = import.meta.env.VITE_BE_URL;

interface ReadyCheck {
    name: string;
    ok: boolean;
    detail: string;
}

const PresentPage = () => {
    const [deck, setDeck] = useState<Deck | null>(null);
    const [deckError, setDeckError] = useState<string | null>(null);
    const [parsing, setParsing] = useState(false);

    const [checks, setChecks] = useState<ReadyCheck[] | null>(null);
    const [checking, setChecking] = useState(false);

    const [started, setStarted] = useState(false);
    const [input, setInput] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // The transport is created once, so it reads the deck through a ref rather
    // than closing over a stale value.
    const deckRef = useRef<Deck | null>(null);
    deckRef.current = deck;

    const { messages, sendMessage, status, error } = useChat({
        transport: new DefaultChatTransport({
            api: `${apiUrl}/present`,
            body: () => ({ deck: deckRef.current }),
        }),
    });

    const busy = status === 'submitted' || status === 'streaming';

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        setParsing(true);
        setDeckError(null);
        try {
            setDeck(await parseDeck(file));
        } catch (err) {
            setDeck(null);
            setDeckError(err instanceof Error ? err.message : 'Could not read that file.');
        } finally {
            setParsing(false);
        }
    };

    const runChecks = async () => {
        setChecking(true);
        setChecks(null);
        try {
            const res = await fetch(`${apiUrl}/ready`);

            // Another application on the port answers, just not ours — that
            // happened here, where a different project's dev server held 3001
            // and redirected to its own login page. Reporting "could not reach"
            // sends you looking for a server that is running perfectly well.
            if (!res.ok || !res.headers.get('content-type')?.includes('json')) {
                setChecks([{
                    name: 'Backend',
                    ok: false,
                    detail: `${apiUrl} answered ${res.status} but not as MyAvatar — ` +
                        'something else is probably using that port. Check VITE_BE_URL.',
                }]);
                return;
            }

            setChecks((await res.json()).checks);
        } catch (err) {
            // Distinguish "not configured" from "not reachable". A missing
            // VITE_BE_URL makes the app fetch "undefined/ready", which fails
            // exactly like a network error and sends you hunting the wrong bug.
            setChecks([{
                name: 'Backend',
                ok: false,
                detail: !apiUrl
                    ? 'VITE_BE_URL is not set — create client/.env.local from ' +
                      '.env.example (local) or set it on the static site (Render), ' +
                      'then rebuild'
                    : `could not reach ${apiUrl} — it may still be waking up (the free ` +
                      `tier takes 30-60s from cold), try again. ` +
                      `${err instanceof Error ? err.message : ''}`,
            }]);
        } finally {
            setChecking(false);
        }
    };

    const ask = () => {
        const text = input.trim();
        if (!text || busy) return;
        sendMessage({ text });
        setInput('');
        inputRef.current?.focus();
    };

    // ---------------- Prepare ----------------
    if (!started) {
        return (
            <div className="present prepare">
                <h1>Presentation Q&amp;A</h1>
                <p className="lede">
                    Load your deck and check everything works — ideally a few minutes before
                    you go on, so the server is awake.
                </p>

                <section className="card">
                    <h2>1. Load your deck</h2>
                    <input
                        type="file"
                        accept=".pptx,.pdf"
                        onChange={e => handleFile(e.target.files?.[0])}
                    />
                    <p className="hint">
                        <strong>.pptx keeps your speaker notes</strong>, which are usually the
                        most useful part. A PDF export drops them entirely.
                    </p>

                    {parsing && <p className="status">Reading deck…</p>}
                    {deckError && <p className="status bad">{deckError}</p>}
                    {deck && (() => {
                        const chars = deck.slides.reduce((n, s) => n + s.text.length, 0);
                        const perSlide = Math.round(chars / deck.slides.length);
                        // An image-heavy deck parses to almost nothing. Better to
                        // say so now than to discover it mid-Q&A.
                        const thin = perSlide < 40;
                        return (
                            <>
                                <p className={`status ${thin ? 'bad' : 'good'}`}>
                                    {deck.name} — {deck.slides.length} slides,{' '}
                                    {chars.toLocaleString()} characters
                                    {deck.hasNotes ? ', speaker notes included' : ', no speaker notes'}
                                </p>
                                {thin && (
                                    <p className="hint">
                                        That is very little text per slide. If your slides are
                                        mostly images or screenshots, there is nothing to read —
                                        the answers will be thin. Speaker notes would fix it.
                                    </p>
                                )}
                                <details className="preview">
                                    <summary>Show exactly what the avatar will read</summary>
                                    {deck.slides.map(slide => (
                                        <div key={slide.number} className="slide-preview">
                                            <h3>Slide {slide.number}</h3>
                                            <pre>{slide.text || '(no text found on this slide)'}</pre>
                                            {slide.notes && (
                                                <pre className="notes">Notes: {slide.notes}</pre>
                                            )}
                                        </div>
                                    ))}
                                </details>
                            </>
                        );
                    })()}
                </section>

                <section className="card">
                    <h2>2. Check it's ready</h2>
                    <button onClick={runChecks} disabled={checking}>
                        {checking ? 'Checking…' : 'Run checks'}
                    </button>
                    <p className="hint">
                        Wakes the server, reloads your background, and spends a few tokens on a
                        real request — the only way to prove the API key still works and has
                        credit.
                    </p>

                    {checks && (
                        <ul className="checks">
                            {checks.map(check => (
                                <li key={check.name} className={check.ok ? 'good' : 'bad'}>
                                    <span className="mark">{check.ok ? '✓' : '✗'}</span>
                                    <strong>{check.name}</strong> {check.detail}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <button
                    className="primary"
                    disabled={!deck}
                    onClick={() => setStarted(true)}
                >
                    Start Q&amp;A
                </button>
                {!deck && <p className="hint">Load a deck to continue.</p>}
            </div>
        );
    }

    // ---------------- Q&A ----------------
    return (
        <div className="present qa">
            <header className="qa-header">
                <span>{deck?.name}</span>
                <button className="link" onClick={() => setStarted(false)}>
                    Back to setup
                </button>
            </header>

            <div className="answers">
                {messages.map(message => {
                    const text = message.parts
                        .filter(part => part.type === 'text')
                        .map(part => part.text)
                        .join('');
                    if (!text) return null;
                    return (
                        <div key={message.id} className={`turn ${message.role}`}>
                            {message.role === 'user' && <span className="who">Q</span>}
                            <p>{text}</p>
                        </div>
                    );
                })}

                {status === 'submitted' && <p className="thinking">Thinking…</p>}
                {error && (
                    <p className="turn assistant error">
                        Something went wrong. If the server was asleep this can take a minute —
                        try again.
                    </p>
                )}
            </div>

            <div className="ask">
                <input
                    ref={inputRef}
                    autoFocus
                    value={input}
                    onChange={e => setInput(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            ask();
                        }
                    }}
                    placeholder="Type the audience question…"
                    disabled={busy}
                />
                <button onClick={ask} disabled={busy || !input.trim()}>
                    Ask
                </button>
            </div>
        </div>
    );
};

export default PresentPage;
