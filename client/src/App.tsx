import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { MAX_MESSAGE_LENGTH } from '@myavatar/shared';
import { speechOutputSupported, useSpeechInput, useSpeechOutput } from './voice/useVoice';
import AvatarOrb, { type OrbState } from './voice/AvatarOrb';
import SpokenText from './voice/SpokenText';
import './App.css';

const apiUrl = import.meta.env.VITE_BE_URL;

const App = () => {
    const [input, setInput] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const { messages, sendMessage, status, error } = useChat({
        transport: new DefaultChatTransport({ api: `${apiUrl}/chat` }),
    });

    // `submitted` covers the gap before the first token arrives, which is where
    // the cold start on the free tier is felt.
    const busy = status === 'submitted' || status === 'streaming';

    const voiceOut = useSpeechOutput();

    // Hands-free: speak, pause, and it sends itself — then keeps listening.
    // Suspended while a reply is in flight or being read aloud, otherwise the
    // mic transcribes the avatar's own voice and asks it straight back.
    const voiceIn = useSpeechInput({
        onUtterance: (text: string) => sendMessage({ text: text.slice(0, MAX_MESSAGE_LENGTH) }),
        suspended: busy || voiceOut.speaking,
    });

    // Speak each reply once, when it finishes streaming — not per chunk.
    const spokenRef = useRef<string | null>(null);
    useEffect(() => {
        if (busy) return;
        const last = messages.at(-1);
        if (!last || last.role !== 'assistant' || last.id === spokenRef.current) return;
        const text = last.parts.filter(p => p.type === 'text').map(p => p.text).join('');
        if (!text) return;
        spokenRef.current = last.id;
        voiceOut.speak(text, last.id);
    }, [busy, messages, voiceOut]);

    // Keep the newest message in view as answers stream in.
    useEffect(() => {
        scrollRef.current?.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: 'smooth',
        });
    }, [messages, busy]);

    const orbState: OrbState = voiceOut.speaking
        ? 'speaking'
        : busy
            ? 'thinking'
            : voiceIn.micOn
                ? 'listening'
                : 'idle';

    // One button, one meaning: whatever is happening, stop it. Otherwise start
    // listening. Interrupting a wrong answer is the thing you reach for in a
    // hurry, so it should not need a second control to find.
    const active = voiceIn.micOn || voiceOut.speaking;
    const handleTalk = () => {
        if (active) {
            voiceOut.stop();
            voiceIn.stop();
        } else {
            voiceIn.toggle();
        }
    };

    const handleSend = () => {
        const text = input.trim();
        if (!text || busy) return;

        sendMessage({ text });
        setInput('');
        inputRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="app">
            {/* Left: the avatar itself, and the primary way in. */}
            <section className="stage">
                <AvatarOrb
                    state={orbState}
                    wordCount={voiceOut.progress.wordCount}
                    synced={voiceOut.progress.synced}
                    size={240}
                />

                <h1 className="title">My Avatar</h1>
                <p className="caption">
                    An AI-powered digital twin of Kaiwei — ask it anything about his
                    background, work and journey.
                </p>

                {voiceIn.supported && (
                    <button
                        className={`talk ${active ? 'live' : ''}`}
                        onClick={handleTalk}
                    >
                        <span className="icon" aria-hidden="true">
                            {active ? '■' : '\u{1F3A4}'}
                        </span>
                        {active ? 'Stop' : 'Chat'}
                    </button>
                )}

                {voiceIn.micOn && (
                    <p className="voice-note">
                        {voiceIn.interim
                            ? `“${voiceIn.interim}”`
                            : 'Listening — just speak, then pause.'}
                    </p>
                )}
                {voiceIn.micOn && !voiceIn.interim && (
                    <p className="voice-note faint">
                        {voiceIn.onDevice
                            ? 'Audio stays on this machine.'
                            : 'This browser sends audio to its speech service.'}
                    </p>
                )}
                {voiceIn.error && <p className="voice-error">{voiceIn.error}</p>}
            </section>

            {/* Right: the conversation. */}
            <section className="panel">
                <div className="chat-window" ref={scrollRef}>
                    {messages.length === 0 && !busy && (
                        <div className="empty">
                            <p>Try asking</p>
                            <ul>
                                <li>What have you been working on lately?</li>
                                <li>What is your experience with React?</li>
                                <li>How do I get in touch?</li>
                            </ul>
                        </div>
                    )}

                    {messages.map(message => {
                        const text = message.parts
                            .filter(part => part.type === 'text')
                            .map(part => part.text)
                            .join('');

                        if (!text) return null;

                        return (
                            <div
                                key={message.id}
                                className={`message ${message.role === 'user' ? 'user' : 'bot'}`}
                            >
                                <SpokenText
                                    text={text}
                                    id={message.id}
                                    progress={voiceOut.progress}
                                />
                            </div>
                        );
                    })}

                    {status === 'submitted' && (
                        <div className="message bot">
                            <span className="spinner"></span> Thinking...
                        </div>
                    )}

                    {error && (
                        <div className="message bot">
                            Something went wrong talking to the assistant. If it has been idle
                            a while, waking up can take a minute — try again.
                        </div>
                    )}
                </div>

                <div className="input-container">
                    <input
                        ref={inputRef}
                        value={voiceIn.micOn && voiceIn.interim ? voiceIn.interim : input}
                        onChange={e => setInput(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                        onKeyDown={handleKeyDown}
                        placeholder={voiceIn.micOn
                            ? 'Listening — speak, then pause…'
                            : 'Or type a question…'}
                        disabled={busy}
                    />
                    <button
                        className="send"
                        onClick={handleSend}
                        disabled={busy || !input.trim()}
                        title="Send"
                    >
                        &#10148;
                    </button>
                    {speechOutputSupported && (
                        <button
                            className={`speak ${voiceOut.enabled ? 'on' : ''}`}
                            onClick={voiceOut.toggle}
                            title={voiceOut.enabled
                                ? 'Replies are read aloud — click to silence'
                                : 'Read replies aloud'}
                        >
                            {voiceOut.enabled ? '\u{1F50A}' : '\u{1F507}'}
                        </button>
                    )}
                </div>
            </section>
        </div>
    );
};

export default App;
